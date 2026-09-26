/**
 * View-level integration test for a pre-paginated (PDF-like) book: drives
 * foliate-view, which wires the fixed-layout renderer, the overlayer, TTS,
 * search and progress together.
 *
 *   node view.test.mjs            # both the ES modules and the legacy bundle
 *   node view.test.mjs modern
 *   node view.test.mjs legacy
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, copyFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..', 'src')
const DIST = join(here, '..', 'dist')

const modes = process.argv[2] ? [process.argv[2]] : ['modern', 'legacy']
let totalFailures = 0

const PAGE_HTML = (i) => `<!DOCTYPE html><html><head>
  <meta name="viewport" content="width=600, height=800">
  </head><body><div id="canvas"></div>
  <div class="textLayer"><span>Hello page ${i}.</span></div>
  <div class="annotationLayer"></div></body></html>`

const makeBook = (numPages, window) => ({
  dir: 'ltr',
  metadata: { language: 'en' },
  rendition: { layout: 'pre-paginated', viewport: { width: 600, height: 800 } },
  isExternal: uri => /^\w+:/i.test(uri),
  resolveHref: async href => ({ index: Number(href) }),
  splitTOCHref: async href => [Number(href), null],
  getTOCFragment: doc => doc.documentElement,
  getCover: async () => new window.Blob(['cover']),
  toc: [{ label: 'Start', href: '2', subitems: null }],
  pageList: null,
  sections: Array.from({ length: numPages }).map((_, i) => ({
    id: i,
    size: 1000,
    load: async () => ({ data: PAGE_HTML(i), src: `blob:page-${i}` }),
    // What search and TTS walk when the page is not on screen
    createDocument: async () => {
      const doc = window.document.implementation.createHTMLDocument('page')
      const textLayer = doc.createElement('div')
      textLayer.className = 'textLayer'
      for (const line of [`Hello page ${i}.`, 'A second sentence for searching.']) {
        const span = doc.createElement('span')
        span.textContent = line
        textLayer.append(span)
        const br = doc.createElement('br')
        textLayer.append(br)
      }
      doc.body.append(textLayer)
      return doc
    },
  })),
})

const setupDom = (window) => {
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
  for (const name of ['ReadableStream', 'WritableStream', 'TransformStream', 'TextDecoder',
    'TextEncoder', 'fetch', 'Response', 'Blob', 'File', 'FileReader', 'URL']) {
    if (!window[name] && globalThis[name]) window[name] = globalThis[name]
  }

  // jsdom loads neither iframes inside a shadow root nor srcdoc documents, so the
  // page document (with a text layer) and its load event are provided here.
  Object.defineProperty(window.HTMLIFrameElement.prototype, 'contentDocument', {
    configurable: true,
    get() {
      if (!this.__doc) {
        const doc = window.document.implementation.createHTMLDocument('page')
        const textLayer = doc.createElement('div')
        textLayer.className = 'textLayer'
        const span = doc.createElement('span')
        span.textContent = 'Hello page from the frame.'
        textLayer.append(span)
        doc.body.append(textLayer)
        this.__doc = doc
      }
      return this.__doc
    },
  })
  // jsdom implements no Range geometry (browsers do)
  const rect = { left: 0, top: 0, right: 40, bottom: 12, width: 40, height: 12, x: 0, y: 0 }
  window.Range.prototype.getClientRects = function () { return [rect] }
  window.Range.prototype.getBoundingClientRect = function () { return rect }

  const frameLoad = (el) => setTimeout(() => el.dispatchEvent(new window.Event('load')), 0)
  for (const prop of ['srcdoc', 'src']) {
    Object.defineProperty(window.HTMLIFrameElement.prototype, prop, {
      configurable: true,
      get() { return this[`__${prop}`] ?? '' },
      set(value) { this[`__${prop}`] = value; frameLoad(this) },
    })
  }
}

const exposeGlobals = (window) => {
  // `performance` stays Node's own: a jsdom Performance would recurse into itself
  // once it is installed as the global (each mode sets up its own DOM).
  for (const name of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'CustomEvent', 'Event',
    'EventTarget', 'Blob', 'File', 'FileReader', 'URL', 'TextDecoder', 'TextEncoder',
    'getComputedStyle', 'customElements', 'DOMRect', 'MutationObserver', 'Range', 'NodeFilter',
    'ResizeObserver', 'IntersectionObserver', 'CSSStyleSheet', 'DOMParser', 'SVGElement']) {
    if (window[name] === undefined) continue
    try {
      globalThis[name] = window[name]
    } catch {
      Object.defineProperty(globalThis, name, { value: window[name], configurable: true })
    }
  }
  globalThis.devicePixelRatio = 1
  globalThis.requestAnimationFrame ??= (cb) => setTimeout(() => cb(Date.now()), 0)
}

const nextTick = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms))

const scratchFor = (name) => {
  const dir = join(tmpdir(), `anx-view-test-${name}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

const loadModules = async (window, window_) => {
  // Copy the ES modules under their own names so their relative imports resolve,
  // and mark them as modules for Node's loader.
  const dir = scratchFor('modern')
  for (const file of readdirSync(SRC).filter(f => f.endsWith('.js'))) {
    copyFileSync(join(SRC, file), join(dir, file))
  }
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }))
  await import(pathToFileURL(join(dir, 'view.js')).href)
}

const loadLegacyBundle = async (window) => {
  const script = window.document.createElement('script')
  script.textContent = readFileSync(join(DIST, 'bundle.js'), 'utf8')
  window.document.head.appendChild(script)
  await nextTick(50)
}

const run = async (mode) => {
  let failures = 0
  let checks = 0
  const ok = (cond, label, extra = '') => {
    checks++
    if (cond) console.log(`  ok   ${label}`)
    else { failures++; console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`) }
  }
  const eq = (actual, expected, label) =>
    ok(Object.is(actual, expected), label, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)

  console.log(`\n=== ${mode} ===`)
  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>
    <div id="footnote-dialog"><main></main></div>
  </body></html>`, {
    url: 'http://127.0.0.1:8080/foliate-js/index.html',
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
  })
  const { window } = dom
  setupDom(window)
  exposeGlobals(window)

  if (mode === 'legacy') await loadLegacyBundle(window)
  else await loadModules(window)

  const view = window.document.createElement('foliate-view')
  window.document.body.append(view)
  const events = { relocate: [], load: [], overlayer: [], draw: [] }
  view.addEventListener('relocate', e => events.relocate.push(e.detail))
  view.addEventListener('load', e => events.load.push(e.detail))
  view.addEventListener('create-overlay', e => events.overlayer.push(e.detail))
  view.addEventListener('draw-annotation', e => events.draw.push(e.detail))

  const book = makeBook(6, window)
  await view.open(book)
  await view.goTo(0)
  await nextTick(40)

  ok(!!window.customElements.get('foliate-fxl'), 'the fixed-layout renderer is registered')
  eq(view.isFixedLayout, true, 'a pre-paginated book uses the fixed-layout renderer')
  ok(view.renderer.tagName === 'FOLIATE-FXL', `renderer is foliate-fxl (${view.renderer.tagName})`)
  eq(view.renderer.pages, 4, 'six pages group into four spreads')
  eq(view.renderer.index, 0, 'the first page is showing')
  eq(view.renderer.primaryIndex, 0, 'primaryIndex tracks the page being read')

  // Relocation: page-level CFI plus a page-accurate chapter location
  const relocation = events.relocate.at(-1)
  ok(!!relocation, 'a relocation was reported')
  eq(relocation.cfi, 'epubcfi(/6/2)', 'the relocation carries the page CFI')
  eq(relocation.range, null, 'fixed-layout relocations have no text range')
  eq(relocation.chapterLocation.current, 1, 'chapter location reports the first page')
  eq(relocation.chapterLocation.total, 6, 'chapter location reports the page count')
  ok(relocation.location.total >= 1,
    `book progress reports its location count (${relocation.location.total})`)
  // Fixed-layout relocations are page-granular: each page reports a full section
  // of progress (size 1), so page 1 of 6 sits at 1/6.
  eq(relocation.fraction, 1 / 6, 'page-granular progress is reported')

  // Overlayer wiring: each visible page gets one
  const contents = view.renderer.getContents()
  ok(contents.length > 0, 'the renderer exposes its frames')
  const withOverlayer = contents.filter(c => c.overlayer?.element)
  ok(withOverlayer.length > 0, 'visible pages got an overlayer')
  ok(withOverlayer.every(c => c.overlayer.element.parentNode),
    'the overlayer is attached to its page')

  // Navigation by CFI (the anchor a stored PDF position uses)
  await view.goTo('epubcfi(/6/8)')
  await nextTick(40)
  eq(view.renderer.index, 3, 'a page CFI navigates to its page')
  eq(view.lastLocation.cfi, 'epubcfi(/6/8)', 'the new location is reported back')
  eq(view.lastLocation.chapterLocation.current, 4, 'and its page number follows')

  // Annotations: a highlight anchored to a page CFI must not throw, and a
  // resolvable range must reach the overlayer
  const returned = await view.addAnnotation({
    value: 'epubcfi(/6/8!/4/2/1:0,/4/2/1:5)', type: 'highlight', color: '#ffcc00',
  })
  eq(returned.index, 3, 'a highlight CFI resolves to its page')
  const drawn = await view.addAnnotation({
    value: view.getCFI(3, (() => {
      const doc = withOverlayer[0].doc
      const range = doc.createRange()
      const textNode = doc.querySelector('.textLayer span')?.firstChild ?? doc.body.firstChild
      range.selectNodeContents(textNode ?? doc.body)
      return range
    })()),
    type: 'highlight', color: '#ffcc00',
  })
  ok(drawn.index === 3, 'a highlight with a real range resolves to its page')
  ok(events.draw.length > 0, 'the range reached the overlayer for drawing')

  // TTS over a fixed-layout page: the sentence must come out of the page's text
  // layer and be highlighted through the overlayer
  await view.initTTS()
  ok(!!view.tts, 'TTS initialised on the primary page')
  const sentence = view.tts?.next(true)
  ok(typeof sentence === 'string' && sentence.includes('Hello page from the frame.'),
    'TTS reads the page text layer', String(sentence))
  view.initTTS(true)
  ok(true, 'TTS highlight can be cleared')

  // In-book search walks the section documents for a fixed-layout book
  const results = []
  for await (const result of view.search({ query: 'Hello', scope: 'book' })) {
    if (result === 'done') break
    if (result.subitems) results.push(...result.subitems)
  }
  ok(results.length > 0, `searching a fixed-layout book finds matches (${results.length})`)
  ok(results.every(r => r.excerpt && typeof r.excerpt.pre === 'string'
    && typeof r.excerpt.match === 'string' && typeof r.excerpt.post === 'string'),
  'every match carries a pre/match/post excerpt')
  ok(results.some(r => r.excerpt.match === 'Hello'), 'the excerpt holds the matched words')
  ok(results.every(r => typeof r.cfi === 'string' && r.cfi.startsWith('epubcfi')), 'matches carry CFIs')

  // Page turns and teardown
  await view.next()
  await nextTick(30)
  ok(view.renderer.index > 3, 'the view turns pages through the renderer')
  view.close()
  ok(true, 'the view closes without throwing')

  console.log(`  ${failures ? 'FAILED' : 'PASSED'}: ${checks - failures}/${checks} checks`)
  return failures
}

for (const mode of modes) {
  totalFailures += await run(mode)
}
console.log(`\n${totalFailures ? 'FAILED' : 'PASSED'}`)
process.exit(totalFailures ? 1 : 0)
