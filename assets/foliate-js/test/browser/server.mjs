/**
 * Serves the reader page the way the app's shelf server does, from the files in
 * the repository, so the real `index.html` bootstrap can be driven in a browser.
 *
 *   node server.mjs [port]
 *
 * Routes (mirroring lib/service/book_player/book_player_server.dart):
 *   /foliate-js/<path>   assets/foliate-js/<path>  (binary and text)
 *   /book/<path>         a local PDF/EPUB file
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const ROOT = join(here, "..", "..")                 // assets/foliate-js
const PORT = Number(process.argv[2] ?? 8085)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.bcmap': 'application/octet-stream',
  '.pfb': 'application/octet-stream',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.pdf': 'application/pdf',
  '.epub': 'application/epub+zip',
  '.wasm': 'application/wasm',
}

// The reader page with the Flutter bridge stubbed and a debug overlay showing
// what the page reports to the app — enough to drive it on a real device (for
// example inside an Android emulator's WebView) and read the result off a
// screenshot.
const STUB = `<script>
window.__report = (label, data) => {
  try { fetch('/__report', { method: 'POST', body: JSON.stringify({ label, data }) }) } catch (e) {}
}
window.addEventListener('error', e => window.__report('error', String(e.message) + ' @ ' + (e.filename || '') + ':' + (e.lineno || '')))
window.addEventListener('unhandledrejection', e => window.__report('rejection', {
  message: e.reason && e.reason.message ? e.reason.message : String(e.reason),
  target: e.reason && e.reason.target && e.reason.target.src ? e.reason.target.src : null,
  type: e.reason && e.reason.type ? e.reason.type : null,
}))
const originalFetch = window.fetch
window.fetch = (...args) => originalFetch(...args).then(res => {
  if (!res.ok) window.__report('fetch-failed', { url: String(args[0]), status: res.status })
  return res
}, err => {
  window.__report('fetch-error', { url: String(args[0]), message: String(err) })
  throw err
})

window.__calls = []
window.flutter_inappwebview = { callHandler: (name, data) => {
  window.__calls.push({ name, data })
  const box = document.getElementById('__dbg')
  if (box) {
    const NL = String.fromCharCode(10)
    const line = name + ' ' + JSON.stringify(data).slice(0, 120)
    box.textContent = [line, ...box.textContent.split(NL).slice(0, 6)].join(NL)
  }
  if (name === 'translateText') return Promise.resolve({ text: '[tr]' })
  if (name === 'onLoadEnd' || name === 'onRelocated' || name === 'onSetToc' || name === 'onMetadata') {
    window.__report('bridge:' + name, data)
  }
  return Promise.resolve(null)
} }

// A device-side interaction run: drives the reader through the app's own JS API
// and reports what happens, so a real WebView can be checked from the host.
window.__runDeviceTest = async () => {
  const wait = ms => new Promise(r => setTimeout(r, ms))
  const report = (label, data) => window.__report('test:' + label, data)
  const view = () => window.reader.view
  const frameDoc = () => {
    const c = view().renderer.getContents().find(x => x.doc && x.doc.querySelector('#canvas > canvas'))
    return c ? c.doc : null
  }
  const canvas = () => {
    const doc = frameDoc()
    return doc ? doc.querySelector('#canvas > canvas') : null
  }
  const state = () => ({
    index: view().renderer.index,
    pages: view().renderer.pages,
    scrolled: view().renderer.scrolled,
    cfi: view().lastLocation && view().lastLocation.cfi,
    chapter: view().lastLocation && view().lastLocation.chapterLocation,
    canvasW: canvas() ? canvas().width : null,
    canvasCss: canvas() ? parseFloat(canvas().style.width) : null,
    scale: frameDoc() ? parseFloat(frameDoc().documentElement.style.getPropertyValue('--scale-factor')) : null,
    spans: frameDoc() ? frameDoc().querySelectorAll('.textLayer span').length : 0,
  })
  try {
    report('start', state())

    // 1. page turn
    window.nextPage(); await wait(2500)
    report('after-next-page', state())

    // 2. zoom: the bitmap must be re-rasterised, not CSS-scaled
    window.changeStyle({ pdfZoomMode: 'fit-width', pdfZoomLevel: 150 }); await wait(3000)
    report('after-zoom', state())

    // 3. continuous scroll flow
    window.changeStyle({ pageTurnStyle: 'scroll' }); await wait(4000)
    const root = view().renderer.shadowRoot
    report('scroll-mode', {
      scrolled: view().renderer.scrolled,
      slots: root.querySelectorAll('.scroll-page').length,
      loaded: root.querySelectorAll('.scroll-page iframe').length,
      firstPageVisible: (() => {
        const el = root.querySelector('.scroll-page')
        if (!el) return null
        const st = getComputedStyle(el)
        return { display: st.display, visibility: st.visibility, h: Math.round(el.getBoundingClientRect().height) }
      })(),
    })
    await wait(1500)
    window.changeStyle({ pageTurnStyle: 'slide' }); await wait(2500)
    report('back-to-paginated', state())

    // 4. in-book search
    const searchCalls = []
    const original = window.flutter_inappwebview.callHandler
    window.flutter_inappwebview.callHandler = (name, data) => {
      if (name === 'onSearch') searchCalls.push(data)
      return original(name, data)
    }
    await window.search('Alice'); await wait(3000)
    const results = searchCalls.filter(r => r.subitems).flatMap(r => r.subitems)
    report('search', {
      results: results.length,
      firstExcerpt: results[0] ? results[0].excerpt : null,
      firstCfi: results[0] ? results[0].cfi : null,
      done: searchCalls.some(r => r.process === 1),
      drawn: view().renderer.getContents().map(c => c.overlayer ? c.overlayer.element.querySelectorAll('g').length : 0),
    })
    window.clearSearch()

    // 5. selection across a line break, then a highlight from its CFI
    const frame = view().renderer.getContents().find(c => c.doc && c.doc.querySelector('.textLayer br'))
    let selectionText = null, selectionCfi = null
    if (frame) {
      const doc = frame.doc
      const children = Array.from(doc.querySelector('.textLayer').children)
      const brIndex = children.findIndex(el => el.tagName === 'BR')
      if (brIndex > 0 && children[brIndex - 1].firstChild && children[brIndex + 1].firstChild) {
        const range = doc.createRange()
        range.setStart(children[brIndex - 1].firstChild, 0)
        range.setEnd(children[brIndex + 1].firstChild, children[brIndex + 1].firstChild.data.length)
        const sel = doc.getSelection()
        sel.removeAllRanges(); sel.addRange(range)
        window.showContextMenu(); await wait(600)
        const call = window.__calls.filter(c => c.name === 'onSelectionEnd').at(-1)
        selectionText = call ? call.data.text : null
        selectionCfi = call ? call.data.cfi : null
      }
    }
    report('selection', { text: selectionText, cfi: selectionCfi })
    if (selectionCfi) {
      await view().addAnnotation({ value: selectionCfi, type: 'highlight', color: '#ffcc00' })
      await wait(800)
      const drawn = view().renderer.getContents()
        .map(c => c.overlayer ? c.overlayer.element.querySelectorAll('g[fill]').length : 0)
      report('highlight', { shapes: drawn })
    }

    // 6. TTS + bookmark
    window.initTts()
    const sentence = await window.ttsNext()
    const detail = window.ttsCurrentDetail()
    window.ttsStop()
    report('tts', { sentence: typeof sentence === 'string' ? sentence.slice(0, 60) : String(sentence), cfi: detail && detail.cfi })
    window.addBookmarkHere(); await wait(500)
    const bookmark = window.__calls.filter(c => c.name === 'handleBookmark').at(-1)
    report('bookmark', { cfi: bookmark && bookmark.data.detail.cfi, content: bookmark && bookmark.data.detail.content })
    report('done', state())
  } catch (e) {
    report('failure', String(e && e.stack ? e.stack.split(String.fromCharCode(10)).slice(0, 3).join(' | ') : e))
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const box = document.createElement('div')
  box.id = '__dbg'
  box.style.cssText = 'position:fixed;left:0;right:0;bottom:0;max-height:30vh;overflow:hidden;'
    + 'font:9px/1.25 monospace;white-space:pre-wrap;background:#000c;color:#0f0;z-index:99999;padding:3px'
  box.textContent = 'bridge stub ready'
  document.body.append(box)
  const state = () => {
    const view = window.reader && window.reader.view
    const renderer = view && view.renderer
    const contents = (renderer && renderer.getContents && renderer.getContents()) || []
    const frame = contents.find(c => c.doc && c.doc.querySelector('#canvas > canvas'))
    const canvas = frame && frame.doc.querySelector('#canvas > canvas')
    const layer = frame && frame.doc.querySelector('.textLayer')
    return {
      fixedLayout: view ? view.isFixedLayout : null,
      pages: renderer ? renderer.pages : null,
      index: renderer ? renderer.index : null,
      scrolled: renderer ? renderer.scrolled : null,
      canvas: canvas ? { w: canvas.width, h: canvas.height, cssW: canvas.style.width } : null,
      spans: layer ? layer.querySelectorAll('span').length : 0,
      text: layer ? layer.textContent.slice(0, 60) : '',
      calls: (window.__calls || []).map(c => c.name),
      lastCfi: view && view.lastLocation ? view.lastLocation.cfi : null,
      chapterPages: view && view.lastLocation ? view.lastLocation.chapterLocation : null,
      toc: window.reader ? JSON.stringify(window.reader.toc || []).slice(0, 120) : null,
      ua: navigator.userAgent.slice(0, 60),
      pdfjsLib: typeof window.pdfjsLib,
      roles: typeof window.PDFJS,
      scripts: Array.from(document.scripts).map(s => (s.src || 'inline').replace(location.origin, '')).slice(-8),
      readerObj: typeof window.reader,
      flutterHandler: typeof window.flutter_inappwebview,
    }
  }
  // report a few times so the host sees the page settle
  ;[4000, 9000, 15000, 25000].forEach(ms => setTimeout(() => window.__report('state', state()), ms))
  if (location.search.includes('run=1')) setTimeout(() => window.__runDeviceTest(), 12000)
})
</script>
`

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`)
  const path = decodeURIComponent(url.pathname)
  try {
    if (path === '/__report' && req.method === 'POST') {
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const body = Buffer.concat(chunks).toString('utf8')
      console.log('=== REPORT ===')
      console.log(body.slice(0, 6000))
      res.writeHead(204, { 'Access-Control-Allow-Origin': '*' })
      res.end()
      return
    }
    if (path === '/reader-test.html' || path === '/foliate-js/reader-test.html') {
      const html = await readFile(join(ROOT, 'index.html'), 'utf8')
      const body = html.replace('<title>', `${STUB}<title>`)
      console.log(`GET /reader-test.html -> 200 (${body.length}B)`)
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      })
      res.end(body)
      return
    }
    if (path.startsWith('/foliate-js/')) {
      const rel = normalize(path.slice('/foliate-js/'.length))
      if (rel.startsWith('..')) throw new Error('escape')
      const file = join(ROOT, rel)
      const info = await stat(file)
      if (!info.isFile()) throw new Error('not a file')
      const body = await readFile(file)
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
        'Content-Length': body.length,
      })
      console.log(`GET ${path} -> 200 (${body.length}B)`)
      res.end(body)
      return
    }
    if (path.startsWith('/book/')) {
      const file = decodeURIComponent(path.slice('/book/'.length))
      const body = await readFile(file)
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/epub+zip',
        'Access-Control-Allow-Origin': '*',
        'Content-Length': body.length,
      })
      console.log(`GET /book/${file} -> 200 (${body.length}B)`)
      res.end(body)
      return
    }
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end(`not found: ${path}`)
  } catch (e) {
    console.log(`${req.method} ${path} -> 404 (${e.message})`)
    res.writeHead(404, { 'Content-Type': 'text/plain' })
    res.end(`not found: ${path} (${e.message})`)
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`reader server on http://127.0.0.1:${PORT}`)
  console.log(`  reader page: http://127.0.0.1:${PORT}/foliate-js/index.html`)
})
