/**
 * Loads the checked-in legacy build (dist/bundle.js — what old Android WebViews
 * run) into a jsdom DOM and drives the ported fixed-layout renderer through it,
 * so the transpiled ES5 artifact is covered too, not just the ES modules.
 *
 *   node legacy.test.mjs
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
const DIST = join(here, '..', 'dist')

let failures = 0
let checks = 0
const ok = (cond, label, extra = '') => {
  checks++
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`) }
}
const eq = (actual, expected, label) =>
  ok(Object.is(actual, expected), label, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)

// Mirrors the reader page's DOM: the bundle wires the footnote dialog up at
// module load.
const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>
  <div id="footnote-dialog"><main></main></div>
</body></html>`, {
  url: 'http://127.0.0.1:8080/foliate-js/index.html',
  runScripts: 'dangerously',
  resources: 'usable',
  pretendToBeVisual: true,
})
const { window } = dom

class ObserverStub {
  constructor(callback) { this.callback = callback }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() { return [] }
}
window.ResizeObserver = ObserverStub
window.IntersectionObserver = ObserverStub
window.Element.prototype.scrollIntoView = function () {}
window.Element.prototype.scrollBy = function () {}
window.HTMLElement.prototype.scrollBy = function () {}
window.CSSStyleSheet = class CSSStyleSheet {
  constructor() { this.cssText = '' }
  replaceSync(text) { this.cssText = text }
  replace(text) { this.cssText = text; return Promise.resolve(this) }
  insertRule(rule) { this.cssText += rule; return 0 }
  deleteRule() {}
}
window.structuredClone = globalThis.structuredClone
// jsdom lacks the streams the reader's zip/vendor modules touch at load time
// (browsers have had them since Chrome 67)
for (const name of ['ReadableStream', 'WritableStream', 'TransformStream', 'TextDecoder', 'TextEncoder',
  'fetch', 'Response', 'Request', 'Headers', 'Blob', 'File', 'FileReader', 'URL']) {
  if (!window[name] && globalThis[name]) window[name] = globalThis[name]
}

// jsdom does not load iframes inside a shadow root, so deliver the load event
// (and a document) the renderer waits for itself.
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

// ---------------------------------------------------------------------------
console.log('\n[1] the legacy bundle loads and registers the elements')
const source = readFileSync(join(DIST, 'bundle.js'), 'utf8')
const script = window.document.createElement('script')
script.textContent = source
window.document.head.appendChild(script)
await new Promise(resolve => setTimeout(resolve, 50))

ok(!!window.customElements.get('foliate-view'), 'foliate-view is defined by the bundle')

// The PDF pipeline is part of the bundle (a PDF opened on an old engine goes
// through these)
ok(source.includes('pre-paginated') && source.includes('.textLayer'),
  'the bundle carries the PDF page-document path')
ok(source.includes('--scale-factor'), 'the bundle carries the pdf.js text layer scaling')
ok(source.includes('connectRangeTransport') || source.includes('requestDataRange'),
  'the bundle carries the throttled range transport')

// ---------------------------------------------------------------------------
console.log('\n[2] fixed-layout rendering through the bundle')
const pageDoc = (i) => `<!DOCTYPE html><html><head>
  <meta name="viewport" content="width=600, height=800">
  </head><body><div id="canvas"></div>
  <div class="textLayer"><span>page ${i}</span></div>
  <div class="annotationLayer"></div></body></html>`

const makeBook = (numPages) => ({
  dir: 'ltr',
  rendition: { layout: 'pre-paginated', viewport: { width: 600, height: 800 } },
  isExternal: uri => /^\w+:/i.test(uri),
  resolveHref: async href => ({ index: Number(href) }),
  splitTOCHref: async href => [Number(href), null],
  getTOCFragment: doc => doc.documentElement,
  getCover: async () => new window.Blob(['cover']),
  sections: Array.from({ length: numPages }).map((_, i) => ({
    id: i,
    size: 1000,
    load: async () => ({ data: pageDoc(i), src: `blob:page-${i}` }),
  })),
})

const nextTick = (ms = 10) => new Promise(resolve => setTimeout(resolve, ms))

{
  // Opening a pre-paginated book is what pulls the fixed-layout renderer in
  const view = window.document.createElement('foliate-view')
  window.document.body.append(view)
  const events = { relocate: [], load: [], overlayer: [] }
  view.addEventListener('relocate', e => events.relocate.push(e.detail))
  view.addEventListener('load', e => events.load.push(e.detail))
  view.addEventListener('create-overlay', e => events.overlayer.push(e.detail))
  await view.open(makeBook(6))
  await view.goTo(0)
  await nextTick()

  ok(!!window.customElements.get('foliate-fxl'), 'foliate-fxl is defined once a book opens')
  const renderer = view.renderer
  ok(!!renderer?.open, 'the view picked the fixed-layout renderer')

  eq(renderer.index, 0, 'the first page is showing')
  eq(renderer.pages, 4, 'six pages group into four spreads (cover alone first)')
  eq(renderer.primaryIndex, 0, 'primaryIndex reports the page being read')
  ok(events.load.length > 0, 'page documents load')
  ok(events.overlayer.length > 0, 'the renderer asks for an overlayer')
  ok(events.relocate.length > 0, 'relocations reach the view')

  await renderer.next()
  await nextTick()
  ok(renderer.index > 0, `next() advances (now ${renderer.index})`)

  renderer.setAttribute('zoom', 'fit-width')
  renderer.setAttribute('scale-factor', '150')
  renderer.setAttribute('lock-pan-x', '')
  await nextTick()
  eq(renderer.getAttribute('scale-factor'), '150', 'the zoom level is applied')
  ok(typeof renderer.isOverflowX === 'boolean',
    'overflow is reported as a flag (jsdom has no layout, so it stays false)')

  renderer.setAttribute('flow', 'scrolled')
  await nextTick()
  ok(renderer.scrolled, 'the bundle scrolls a PDF continuously')
  eq(renderer.pages, 6, 'every page has a strip slot')
  renderer.setAttribute('flow', 'paginated')
  await nextTick()
  ok(!renderer.scrolled, 'and returns to paginated flow')

  view.close()
}

console.log(`\n${failures ? 'FAILED' : 'PASSED'}: ${checks - failures}/${checks} checks`)
process.exit(failures ? 1 : 0)
