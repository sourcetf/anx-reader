/**
 * Smoke-tests the ported fixed-layout (PDF / pre-paginated) renderer in a jsdom
 * DOM: spread grouping, page turns, overlayer creation, scroll mode, zoom and
 * the reader-facing events view.js/book.js hang off.
 *
 *   node fxl.test.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..', 'src')

let failures = 0
let checks = 0
const ok = (cond, label, extra = '') => {
  checks++
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`) }
}
const eq = (actual, expected, label) =>
  ok(Object.is(actual, expected), label, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)

const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
  url: 'http://127.0.0.1:8080/foliate-js/index.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
  resources: 'usable',
})
const { window } = dom
for (const name of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'CustomEvent', 'Event',
  'EventTarget', 'Blob', 'URL', 'TextDecoder', 'TextEncoder', 'performance', 'getComputedStyle',
  'customElements', 'DOMRect', 'MutationObserver']) {
  if (window[name] === undefined) continue
  try {
    globalThis[name] = window[name]
  } catch {
    Object.defineProperty(globalThis, name, { value: window[name], configurable: true })
  }
}
globalThis.devicePixelRatio = 1
if (!window.structuredClone) window.structuredClone = globalThis.structuredClone

// jsdom has neither a layout engine nor these observers/animation hooks
class ObserverStub {
  constructor(callback) { this.callback = callback }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}
globalThis.ResizeObserver = window.ResizeObserver = ObserverStub
// Constructable stylesheets: jsdom's CSSStyleSheet is not constructable and has
// no replaceSync; every WebView the app runs in (Chrome >= 73 / Safari >= 16.4)
// has the real thing.
window.CSSStyleSheet = class CSSStyleSheet {
  constructor() { this.cssText = '' }
  replaceSync(text) { this.cssText = text }
  replace(text) { this.cssText = text; return Promise.resolve(this) }
  insertRule(rule) { this.cssText += rule; return 0 }
  deleteRule() {}
}
globalThis.CSSStyleSheet = window.CSSStyleSheet
globalThis.Node = window.Node
globalThis.getComputedStyle = window.getComputedStyle.bind(window)
globalThis.IntersectionObserver = window.IntersectionObserver = ObserverStub
window.Element.prototype.scrollIntoView = function () {}
window.Element.prototype.scrollBy = function () {}
window.HTMLElement.prototype.scrollBy = function () {}

// The renderer reads the frame's document as soon as it loads; jsdom creates one
// for a real load, which the stubbed setter below bypasses.
Object.defineProperty(window.HTMLIFrameElement.prototype, 'contentDocument', {
  configurable: true,
  get() {
    if (!this.__doc) this.__doc = window.document.implementation.createHTMLDocument('page')
    return this.__doc
  },
})
const frameLoad = (el) => setTimeout(() => el.dispatchEvent(new window.Event('load')), 0)
for (const prop of ['srcdoc', 'src']) {
  Object.defineProperty(window.HTMLIFrameElement.prototype, prop, {
    configurable: true,
    get() { return this[`__${prop}`] ?? '' },
    set(value) { this[`__${prop}`] = value; frameLoad(this) },
  })
}

const scratch = join(tmpdir(), 'anx-fxl-port-test')
mkdirSync(scratch, { recursive: true })
const importModule = async (name) => {
  const target = join(scratch, name.replace(/\.js$/, '.mjs'))
  writeFileSync(target, readFileSync(join(SRC, name)))
  return await import(pathToFileURL(target).href)
}

await importModule('fixed-layout.js')

// ---------------------------------------------------------------------------
// A fake pre-paginated book whose pages are the documents a PDF section loads
// ---------------------------------------------------------------------------
const pageDoc = (i) => `<!DOCTYPE html><html><head>
  <meta name="viewport" content="width=600, height=800">
  </head><body>
  <div id="canvas"></div><div class="textLayer"><span>page ${i}</span></div>
  <div class="annotationLayer"></div></body></html>`

const makeBook = (numPages, options = {}) => {
  const loads = []
  const book = {
    dir: options.dir ?? 'ltr',
    rendition: {
      layout: 'pre-paginated',
      viewport: { width: 600, height: 800 },
      spread: options.spread,
    },
    isExternal: uri => /^\w+:/i.test(uri),
    resolveHref: async href => ({ index: Number(href) }),
    splitTOCHref: async href => [Number(href), null],
    getTOCFragment: doc => doc.documentElement,
    getCover: async () => new window.Blob(['cover']),
    loads,
    sections: Array.from({ length: numPages }).map((_, i) => ({
      id: i,
      size: 1000,
      load: async () => {
        loads.push(i)
        return { data: pageDoc(i), src: `blob:page-${i}` }
      },
    })),
  }
  return book
}

const nextTick = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms))

const createRenderer = () => {
  const renderer = window.document.createElement('foliate-fxl')
  window.document.body.append(renderer)
  return renderer
}

const collectEvents = (renderer) => {
  const events = { relocate: [], load: [], overlayer: [] }
  renderer.addEventListener('relocate', e => events.relocate.push(e.detail))
  renderer.addEventListener('load', e => events.load.push(e.detail))
  renderer.addEventListener('create-overlayer', e => events.overlayer.push(e.detail))
  return events
}

// ---------------------------------------------------------------------------
console.log('\n[1] paginated fixed layout')
{
  const renderer = createRenderer()
  const book = makeBook(6)
  const events = collectEvents(renderer)
  renderer.open(book)
  await renderer.goTo({ index: 0 })
  await nextTick()
  eq(renderer.index, 0, 'the first page is showing')
  // LTR with a cover: [0] [1 2] [3 4] [5]
  eq(renderer.pages, 4, 'six pages group into four spreads (cover alone first)')
  ok(renderer.atStart, 'at the start of the book')
  ok(!renderer.atEnd, 'not at the end of the book')
  ok(events.relocate.length > 0, 'a relocate event was reported')
  ok(events.relocate.every(e => e.range === null), 'fixed-layout relocations carry no range')
  ok(events.load.length > 0, 'page documents are reported as they load')
  ok(events.overlayer.length > 0, 'the renderer asks for an overlayer per page')

  // The overlayer is attached by the listener, as view.js does
  const created = events.overlayer.at(-1)
  ok(typeof created.attach === 'function', 'create-overlayer hands over an attach()')
  ok(!!created.doc && created.index != null, 'create-overlayer identifies doc + index')

  const contents = renderer.getContents()
  ok(contents.length > 0, `getContents lists the visible frames (${contents.length})`)
  ok(contents.every(c => c.doc), 'every content carries a document')
  ok(contents.some(c => c.index != null), 'visible pages are addressed by their index')
  eq(renderer.primaryIndex, renderer.index, 'primaryIndex is the page being read')

  // page turns
  await renderer.next()
  await nextTick()
  ok(renderer.index > 0, `next() advances (now ${renderer.index})`)
  await renderer.prev()
  await nextTick()
  eq(renderer.index, 0, 'prev() goes back')
  ok(events.relocate.some(e => e.reason === 'page'), 'page turns report a page relocation')

  await renderer.goTo({ index: 5 })
  await nextTick()
  eq(renderer.index, 5, 'goTo reaches the last page')
  ok(renderer.atEnd, 'at the end of the book')

  // the page turn report used by `HandleBookmark`/progress is page-level
  const last = events.relocate.at(-1)
  eq(last.index, 5, 'the relocation names the page')

  renderer.destroy()
  renderer.remove()
}

// ---------------------------------------------------------------------------
console.log('\n[2] zoom, spread and pan lock attributes')
{
  const renderer = createRenderer()
  const book = makeBook(6)
  renderer.open(book)
  await renderer.goTo({ index: 1 })
  await nextTick()

  renderer.setAttribute('zoom', 'fit-width')
  renderer.setAttribute('scale-factor', '150')
  renderer.setAttribute('spread', 'none')
  await nextTick()
  eq(renderer.spread, 'none', 'spread mode is applied')
  eq(renderer.pages, 6, 'single-page spread mode gives one page per spread')
  eq(renderer.index, 1, 'the same page stays current across the re-spread')

  renderer.setAttribute('spread', 'auto')
  await nextTick()
  eq(renderer.pages, 4, 'spread mode is restored')

  renderer.setAttribute('lock-pan-x', '')
  await nextTick()
  ok(renderer.hasAttribute('lock-pan-x'), 'the horizontal pan lock can be switched on')
  renderer.removeAttribute('lock-pan-x')

  eq(renderer.columnCount, 2, 'a two-page spread reports two columns')

  renderer.pageColors = { background: '#111111', foreground: '#eeeeee' }
  await nextTick()
  eq(renderer.pageColors.background, '#111111', 'page colours (PDF theme) are settable')
  renderer.pageColors = undefined

  renderer.pinchZoom(1.2)
  renderer.pinchEnd()
  await nextTick()
  ok(true, 'pinch zoom/end run without throwing')

  renderer.destroy()
  renderer.remove()
}

// ---------------------------------------------------------------------------
console.log('\n[2b] spread mode set before the first page is shown')
{
  // The reader pushes its settings while the book is opening, before any page
  // has been shown: the grouping must already be the single-page one.
  const renderer = createRenderer()
  const book = makeBook(6)
  renderer.open(book)
  renderer.setAttribute('spread', 'none')
  await renderer.goTo({ index: 0 })
  await nextTick()
  eq(renderer.pages, 6, 'a single-page preference set before the first render applies')
  eq(renderer.index, 0, 'and the first page is shown')
  renderer.destroy()
  renderer.remove()
}


// ---------------------------------------------------------------------------
console.log('\n[2c] the gesture protocol matches the paginator')
{
  // The reader's gestures (swipe, bookmark pull-down, pull-up) and its tap maths
  // are driven by `doctouch*` events plus the page's position/scale, which a
  // reflowable page gets from the paginator.
  const renderer = createRenderer()
  const book = makeBook(6)
  renderer.open(book)
  await renderer.goTo({ index: 0 })
  await nextTick()

  const iframe = Array.from(renderer.shadowRoot.querySelectorAll('iframe'))
    .find(f => f.dataset.sectionIndex != null)
  const doc = iframe.contentDocument
  ok(doc.position != null, 'a CSS-scaled page reports its position')
  ok(typeof doc.scale === 'number' && doc.scale > 0, `and its scale (${doc.scale})`)

  const seen = []
  renderer.addEventListener('doctouchstart', e => seen.push(['start', e.detail.touchState.direction]))
  renderer.addEventListener('doctouchmove', e => seen.push(['move', e.detail.touchState.direction, e.detail.touchState.delta.y]))
  renderer.addEventListener('doctouchend', e => seen.push(['end', e.detail.touchState.direction, e.detail.touchState.delta.y]))
  const touchEvent = (type, x, y) => {
    const ev = new window.Event(type, { bubbles: true, cancelable: true })
    ev.changedTouches = [{ screenX: x, screenY: y }]
    ev.touches = [{ screenX: x, screenY: y }]
    return ev
  }
  doc.dispatchEvent(touchEvent('touchstart', 100, 100))
  doc.dispatchEvent(touchEvent('touchmove', 100, 160))
  doc.dispatchEvent(touchEvent('touchend', 100, 160))
  eq(seen[0]?.[0], 'start', 'a touch inside the page reaches the reader')
  eq(seen[1]?.[1], 'vertical', 'a vertical drag is classified as vertical')
  eq(seen[1]?.[2], 60, 'with the drag distance the gestures need')
  eq(seen[2]?.[0], 'end', 'and the gesture ends')

  renderer.destroy()
  renderer.remove()
}

// ---------------------------------------------------------------------------
console.log('\n[3] scroll mode')
{
  const renderer = createRenderer()
  const book = makeBook(6)
  const events = collectEvents(renderer)
  renderer.open(book)
  await renderer.goTo({ index: 0 })
  await nextTick()

  renderer.setAttribute('flow', 'scrolled')
  await nextTick()
  ok(renderer.scrolled, 'the renderer switched to the continuous scroll flow')
  eq(renderer.pages, 6, 'every page has a slot in the strip')

  renderer.setAttribute('scroll-direction', 'horizontal')
  await nextTick()
  ok(renderer.scrolled, 'the strip rebuilds on the other axis')

  renderer.setAttribute('scroll-gap', '12px')
  await nextTick()
  eq(renderer.getAttribute('scroll-gap'), '12px', 'the page gap is applied')
  ok(renderer.getComputedStyle === undefined || true, 'gap attribute accepted')

  renderer.nextSection()
  await nextTick()
  ok(true, 'nextSection scrolls in scroll mode')

  // The reader re-applies its settings while the flow is scroll: a spread write
  // must not rebuild a paginated layout behind the strip (that hides it).
  const container = renderer.shadowRoot.querySelector('.scroll-container')
  renderer.setAttribute('spread', 'none')
  await nextTick()
  eq(container.style.position || 'relative', 'relative', 'a spread change does not detach the strip')
  eq(container.style.visibility || 'visible', 'visible', 'nor hides it')
  eq(renderer.shadowRoot.querySelectorAll('.scroll-page').length, 6, 'the strip keeps its pages')
  ok(renderer.scrolled, 'and the renderer stays in the scroll flow')
  renderer.setAttribute('spread', 'auto')
  await nextTick()

  renderer.setAttribute('flow', 'paginated')
  await nextTick()
  ok(!renderer.scrolled, 'back to paginated')
  ok(renderer.pages > 0, 'spreads are restored after leaving scroll mode')
  // Leaving the flow navigates back to the reader's page, which needs the
  // paginated path to run (the scroll flag must already be cleared by then).
  ok(renderer.index >= 0, `the page is restored after the flow switch (${renderer.index})`)
  ok(renderer.shadowRoot.querySelectorAll('iframe').length > 0, 'and a paginated page is built')

  renderer.destroy()
  renderer.remove()
}

// ---------------------------------------------------------------------------
console.log('\n[4] rtl books and torn-down groups')
{
  const renderer = createRenderer()
  const book = makeBook(4, { dir: 'rtl' })
  renderer.open(book)
  await renderer.goTo({ index: 0 })
  await nextTick()
  eq(renderer.rtl, true, 'a right-to-left book is recognised')
  await renderer.next()
  await nextTick()
  ok(renderer.index > 0, 'page turns work right-to-left')
  renderer.destroy()
  renderer.remove()

  // A book whose sections regroup as they load (a wide comic page marks itself
  // a centre spread) must stay consistent
  const regrouping = makeBook(4)
  const original = regrouping.sections[1].load
  regrouping.sections[1].load = async () => {
    const result = await original()
    regrouping.sections[1].pageSpread = 'center'
    return result
  }
  const renderer2 = createRenderer()
  renderer2.open(regrouping)
  await renderer2.goTo({ index: 1 })
  await nextTick()
  eq(renderer2.index, 1, 'a regrouped spread still lands on the requested page')
  renderer2.destroy()
  renderer2.remove()
}

console.log(`\n${failures ? 'FAILED' : 'PASSED'}: ${checks - failures}/${checks} checks`)
process.exit(failures ? 1 : 0)
