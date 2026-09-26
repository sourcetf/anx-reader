/**
 * Covers the one path the other suites cannot: what `render()` does to a page
 * document — the bitmap box (over-sampled raster, display-sized CSS box), the
 * text layer built at the display scale, the annotation layer, and the guard
 * that keeps an identical re-render from tearing the text layer down.
 *
 * jsdom has no 2D canvas and node-canvas is not installable here, so the canvas
 * context is a recording stub: the drawing itself is not verified, but every
 * size, scale and DOM decision around it is.
 *
 *   node render.test.mjs
 *
 * Needs the sample PDFs like pdf.test.mjs (ANX_PDF_FIXTURES).
 */
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSDOM } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..', 'src')
const VENDOR = join(SRC, 'vendor', 'pdfjs')
const FIXTURES = process.env.ANX_PDF_FIXTURES ?? join(here, 'fixtures')

let failures = 0
let checks = 0
const ok = (cond, label, extra = '') => {
  checks++
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`) }
}
const eq = (actual, expected, label, tolerance = 0) => {
  const pass = tolerance
    ? Math.abs(actual - expected) <= tolerance
    : Object.is(actual, expected)
  ok(pass, label, `got ${actual}, want ${expected}`)
}

// ---------------------------------------------------------------------------
const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>
  <div id="footnote-dialog"><main></main></div>
</body></html>`, {
  url: 'http://127.0.0.1:8080/foliate-js/index.html',
  runScripts: 'dangerously',
  pretendToBeVisual: true,
})
const { window } = dom

for (const name of ['window', 'document', 'Node', 'Element', 'HTMLElement', 'CustomEvent', 'Event',
  'EventTarget', 'Blob', 'File', 'FileReader', 'URL', 'TextDecoder', 'TextEncoder', 'DOMParser',
  // `performance` stays Node's: a jsdom Performance recurses into itself once
  // installed as the global of a second JSDOM instance
  'getComputedStyle', 'MutationObserver', 'Range', 'NodeFilter']) {
  if (window[name] === undefined) continue
  try {
    globalThis[name] = window[name]
  } catch {
    Object.defineProperty(globalThis, name, { value: window[name], configurable: true })
  }
}
globalThis.devicePixelRatio = 1
if (!window.structuredClone) window.structuredClone = globalThis.structuredClone
if (!window.ReadableStream) window.ReadableStream = globalThis.ReadableStream
if (!window.TextDecoder) window.TextDecoder = globalThis.TextDecoder
if (!window.TextEncoder) window.TextEncoder = globalThis.TextEncoder
// the page documents are handed over as blob URLs; jsdom has no object URLs
const objectUrls = new Map()
let urlCounter = 0
window.URL.createObjectURL = (blob) => {
  const url = `blob:http://127.0.0.1:8080/${++urlCounter}`
  objectUrls.set(url, blob)
  return url
}
window.URL.revokeObjectURL = (url) => objectUrls.delete(url)
Object.defineProperty(globalThis, 'URL', { value: window.URL, configurable: true, writable: true })
// jsdom's Blob has no arrayBuffer(); pdf.js reads the file through it
if (!window.Blob.prototype.arrayBuffer) {
  window.Blob.prototype.arrayBuffer = function () {
    return new Promise((resolve, reject) => {
      const reader = new window.FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error)
      reader.readAsArrayBuffer(this)
    })
  }
}

// ---------------------------------------------------------------------------
// A recording 2D context: pdf.js draws into it, the test reads the DOM it made
// ---------------------------------------------------------------------------
const drawingCalls = []
const makeContext = (canvas) => {
  const noop = () => {}
  const target = {
    canvas,
    save: noop, restore: noop, scale: noop, rotate: noop, translate: noop,
    transform: noop, setTransform: noop, resetTransform: noop,
    beginPath: noop, closePath: noop, moveTo: noop, lineTo: noop, bezierCurveTo: noop,
    quadraticCurveTo: noop, arc: noop, arcTo: noop, rect: noop, ellipse: noop,
    fill: () => drawingCalls.push('fill'), stroke: () => drawingCalls.push('stroke'),
    clip: noop, fillRect: () => drawingCalls.push('fillRect'), strokeRect: noop,
    clearRect: noop, fillText: () => drawingCalls.push('fillText'), strokeText: noop,
    drawImage: () => drawingCalls.push('drawImage'),
    putImageData: noop,
    getImageData: (x, y, w, h) => ({
      data: new Uint8ClampedArray(Math.max(4, Math.floor(w * h * 4))),
      width: Math.max(1, Math.floor(w)), height: Math.max(1, Math.floor(h)),
    }),
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(Math.max(4, w * h * 4)), width: w, height: h }),
    createLinearGradient: () => ({ addColorStop: noop }),
    createRadialGradient: () => ({ addColorStop: noop }),
    createConicGradient: () => ({ addColorStop: noop }),
    createPattern: () => ({}),
    measureText: (text) => ({
      width: (`${text ?? ''}`.length || 1) * 5,
      actualBoundingBoxAscent: 8,
      actualBoundingBoxDescent: 2,
      actualBoundingBoxLeft: 0,
      actualBoundingBoxRight: (`${text ?? ''}`.length || 1) * 5,
    }),
    getLineDash: () => [],
    setLineDash: noop,
    getTransform: () => {
      // pdf.js calls invertSelf() on the result (DOMMatrix in a browser)
      const matrix = {
        a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
        invertSelf() { return this },
        multiplySelf() { return this },
        translateSelf() { return this },
        scaleSelf() { return this },
        rotateSelf() { return this },
      }
      return matrix
    },
    isPointInPath: () => false,
    isPointInStroke: () => false,
    fillStyle: '#000', strokeStyle: '#000', font: '10px sans-serif', filter: 'none',
    globalAlpha: 1, globalCompositeOperation: 'source-over', lineWidth: 1,
    lineCap: 'butt', lineJoin: 'miter', miterLimit: 10, lineDashOffset: 0,
    shadowBlur: 0, shadowColor: 'rgba(0,0,0,0)', shadowOffsetX: 0, shadowOffsetY: 0,
    imageSmoothingEnabled: true, imageSmoothingQuality: 'low',
    direction: 'ltr', textAlign: 'start', textBaseline: 'alphabetic',
  }
  return new Proxy(target, {
    get: (t, prop) => (prop in t ? t[prop] : () => undefined),
    set: (t, prop, value) => { t[prop] = value; return true },
  })
}
for (const w of [window]) {
  w.HTMLCanvasElement.prototype.getContext = function (type) {
    return type === '2d' ? makeContext(this) : null
  }
  // jsdom's toBlob needs the canvas package: hand back a stand-in blob
  w.HTMLCanvasElement.prototype.toBlob = function (callback, type) {
    setTimeout(() => callback(new w.Blob(['<stub image>'], { type: type ?? 'image/png' })), 0)
  }
}

// The vendored pdf.js + its worker, as the reader page loads them
const runClassic = (path) => {
  const script = window.document.createElement('script')
  script.textContent = readFileSync(path, 'utf8')
  window.document.head.appendChild(script)
}
runClassic(join(VENDOR, 'pdf.js'))
runClassic(join(VENDOR, 'pdf.worker.js'))
globalThis.pdfjsLib = window.pdfjsLib

const { makePDF } = await (async () => {
  const { writeFileSync, mkdirSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { pathToFileURL } = await import('node:url')
  const dir = join(tmpdir(), 'anx-render-test')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, 'pdf.mjs')
  writeFileSync(target, readFileSync(join(SRC, 'pdf.js')))
  return await import(pathToFileURL(target).href)
})()

const readPdf = (name) => {
  const bytes = readFileSync(join(FIXTURES, name))
  return new window.File([bytes], name, { type: 'application/pdf' })
}

// ---------------------------------------------------------------------------
console.log('\n[1] a page document is rendered at the requested scale')
{
  const book = await makePDF(readPdf('sample-alice.pdf'))
  const pageIndex = 3
  const loaded = await book.sections[pageIndex].load()
  ok(typeof loaded?.onZoom === 'function', 'a section hands the renderer an onZoom hook')
  ok(typeof loaded.data === 'string' && loaded.data.includes('textLayer'),
    'and a page document with a text layer')
  ok(typeof loaded.src === 'string' && loaded.src.startsWith('blob:'),
    'and a blob URL the renderer can load')

  // The page document as the renderer would load it (srcdoc), in its own window
  const pageDom = new JSDOM(loaded.data, { pretendToBeVisual: true })
  const doc = pageDom.window.document
  doc.defaultView.devicePixelRatio = 1

  const page = await (async () => {
    // the natural (scale 1) page size, as pdf.js reports it
    const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(readFileSync(join(FIXTURES, 'sample-alice.pdf'))) }).promise
    return await pdf.getPage(pageIndex + 1)
  })()
  const natural = page.getViewport({ scale: 1 })

  await loaded.onZoom({ doc, scale: 1.5 })

  const canvas = doc.querySelector('#canvas > canvas')
  ok(!!canvas, 'the bitmap lands in #canvas')
  const expectedW = Math.floor(natural.width * 1.5)
  const expectedH = Math.floor(natural.height * 1.5)
  eq(canvas.width, expectedW, 'the bitmap is rasterised at the display scale')
  eq(canvas.height, expectedH, 'bitmap height follows the display scale')
  // The CSS box is the un-truncated display size, so the bitmap fills it exactly
  // (this is what keeps a spread's spine seam from showing)
  eq(canvas.style.width, `${natural.width * 1.5}px`, 'the CSS box is the exact display width')
  eq(canvas.style.height, `${natural.height * 1.5}px`, 'the CSS box is the exact display height')

  const root = doc.documentElement
  eq(root.style.getPropertyValue('--scale-factor'), '1.5', '--scale-factor is published for pdf.js')
  eq(root.style.getPropertyValue('--total-scale-factor'), '1.5', 'the display scale is published')

  const textLayer = doc.querySelector('.textLayer')
  const spans = textLayer.querySelectorAll('span')
  ok(spans.length > 20, `the text layer is built (${spans.length} spans)`)
  ok(textLayer.textContent.length > 200, 'and carries the page text')
  ok(/Alice/i.test(textLayer.textContent), 'the text is the page that was asked for')
  eq(textLayer.style.getPropertyValue('--scale-factor'), '1.5',
    'the text layer knows the scale it was laid out at')
  ok(!!doc.querySelector('.textLayer .endOfContent'), 'the selection end marker is appended')
  ok(drawingCalls.includes('fillText') || drawingCalls.includes('fill') || drawingCalls.includes('drawImage'),
    'the page was actually drawn into the bitmap')

  // -------------------------------------------------------------------------
  console.log('\n[2] an identical re-render is skipped, a changed one is not')
  const firstSpan = spans[0]
  await loaded.onZoom({ doc, scale: 1.5 })
  ok(firstSpan.isConnected, 'the same scale does not rebuild the text layer (TTS ranges survive)')

  await loaded.onZoom({ doc, scale: 2 })
  ok(!firstSpan.isConnected, 'a new scale does rebuild it')
  const zoomed = doc.querySelector('#canvas > canvas')
  eq(zoomed.width, Math.floor(natural.width * 2), 'the bitmap follows the new scale')
  eq(zoomed.style.width, `${natural.width * 2}px`, 'and so does its box')

  // -------------------------------------------------------------------------
  console.log('\n[3] page colours (the PDF theme) re-render the page')
  const beforeColors = doc.querySelector('#canvas > canvas')
  await loaded.onZoom({ doc, scale: 2, pageColors: { background: '#111111', foreground: '#eeeeee' } })
  const afterColors = doc.querySelector('#canvas > canvas')
  ok(beforeColors !== afterColors, 'switching the page colours redraws the bitmap')
  ok(afterColors.width > 0, 'the redrawn bitmap is sized')

  book.destroy()
}

// ---------------------------------------------------------------------------
console.log('\n[4] the cover is rendered as an image')
{
  const book = await makePDF(readPdf('sample-metadata.pdf'))
  const cover = await book.getCover()
  ok(cover instanceof window.Blob, 'the cover comes back as a blob')
  ok((cover?.size ?? 0) > 0, `the cover has content (${cover?.size} bytes)`)
  book.destroy()
}

console.log(`\n${failures ? 'FAILED' : 'PASSED'}: ${checks - failures}/${checks} checks`)
process.exit(failures ? 1 : 0)
