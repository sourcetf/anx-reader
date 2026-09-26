/**
 * Verifies the ported foliate-js PDF pipeline (anx-reader/assets/foliate-js/src)
 * against the app's vendored pdf.js 3.11 build, in a jsdom DOM.
 *
 *   node pdf.test.mjs
 *
 * Covered:
 *   - makePDF: metadata (Info + XMP), TOC page indices, page labels, sections,
 *     createDocument text, href resolution, bounded range-read concurrency,
 *     destroy()
 *   - pdf-text.js: line-break classification and paragraph reassembly
 *   - epubcfi fake CFIs (the per-page anchors a PDF uses)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { JSDOM } from 'jsdom'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..', 'src')
const VENDOR = join(SRC, 'vendor/pdfjs')

let failures = 0
let checks = 0
const ok = (cond, label, extra = '') => {
  checks++
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`) }
}
const eq = (actual, expected, label) =>
  ok(Object.is(actual, expected), label, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------
const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
  url: 'http://127.0.0.1:8080/foliate-js/index.html',
  runScripts: 'dangerously',
})
const { window } = dom

// Globals the foliate modules expect
for (const name of ['window', 'document', 'DOMParser', 'Node', 'Element', 'HTMLElement',
  'CustomEvent', 'Event', 'EventTarget', 'Blob', 'File', 'FileReader', 'URL', 'TextDecoder',
  'TextEncoder', 'performance', 'requestAnimationFrame', 'getComputedStyle', 'ResizeObserver',
  'IntersectionObserver', 'MutationObserver', 'HTMLCanvasElement', 'Image', 'Worker']) {
  if (window[name] === undefined) continue
  try {
    globalThis[name] = window[name]
  } catch {
    // Node 22 defines some of these as getters only (navigator); define instead
    Object.defineProperty(globalThis, name, { value: window[name], configurable: true })
  }
}
globalThis.devicePixelRatio = 1
// pdf.js's in-process ("fake") worker port posts messages with structuredClone,
// which jsdom does not implement
if (!window.structuredClone) window.structuredClone = globalThis.structuredClone
// jsdom's Blob has no arrayBuffer(); pdf.js reads the file through it. (WebViews
// have had it for years: Safari 14, Chrome 76.)
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
if (!window.TextDecoder) window.TextDecoder = globalThis.TextDecoder
if (!window.TextEncoder) window.TextEncoder = globalThis.TextEncoder
if (!window.ReadableStream) window.ReadableStream = globalThis.ReadableStream
if (!window.TransformStream) window.TransformStream = globalThis.TransformStream
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} }
}

// Load the vendored pdf.js (classic script) and its worker into the jsdom window
const runClassic = (path) => {
  const script = window.document.createElement('script')
  script.textContent = readFileSync(path, 'utf8')
  window.document.head.appendChild(script)
}
runClassic(join(VENDOR, 'pdf.js'))
runClassic(join(VENDOR, 'pdf.worker.js'))
globalThis.pdfjsLib = window.pdfjsLib
ok(!!window.pdfjsLib, 'vendored pdf.js loads and exposes pdfjsLib')
ok(!!window.pdfjsWorker?.WorkerMessageHandler, 'vendored pdf.worker.js exposes WorkerMessageHandler')

// The foliate modules are ES modules; import them from copies the loader accepts
const scratch = join(tmpdir(), 'anx-pdf-port-test')
mkdirSync(scratch, { recursive: true })
const importModule = async (name) => {
  const target = join(scratch, name.replace(/\.js$/, '.mjs'))
  writeFileSync(target, readFileSync(join(SRC, name)))
  // pdf-text.js / epubcfi.js are self-contained; pdf.js only needs globals
  return await import(pathToFileURL(target).href)
}

const { makePDF, parsePDFMetadata, decodePDFString, connectRangeTransport } = await importModule('pdf.js')
const { classifyPdfLineBreaks, getPdfTextFromRange, getSelectionText } = await importModule('pdf-text.js')
const CFI = await importModule('epubcfi.js')

const FIXTURES = process.env.ANX_PDF_FIXTURES ?? join(here, 'fixtures')
const readPdf = (name) => {
  const bytes = readFileSync(join(FIXTURES, name))
  return new window.File([bytes], name, { type: 'application/pdf' })
}

// ---------------------------------------------------------------------------
// 1. pure metadata helpers
// ---------------------------------------------------------------------------
console.log('\n[1] metadata helpers')
eq(decodePDFString([0xfe, 0xff, 0x00, 0x41, 0x00, 0x42]), 'AB', 'decodePDFString utf-16be BOM')
eq(decodePDFString([0xff, 0xfe, 0x41, 0x00]), 'A', 'decodePDFString utf-16le BOM')
eq(decodePDFString([0xef, 0xbb, 0xbf, 0x41]), 'A', 'decodePDFString utf-8 BOM')
eq(decodePDFString([0x80]), '\u2022', 'decodePDFString PDFDocEncoding bullet')
eq(decodePDFString('plain'), 'plain', 'decodePDFString passes strings through')
{
  const metadata = parsePDFMetadata({
    info: { Title: [0xfe, 0xff, 0x00, 0x54, 0x00, 0x69], Author: [0x41, 0x75] },
    xmp: `<?xpacket begin=""?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF
      xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <rdf:Description xmlns:dc="http://purl.org/dc/elements/1.1/">
        <dc:title><rdf:Alt><rdf:li xml:lang="x-default">XMP Title</rdf:li></rdf:Alt></dc:title>
      </rdf:Description></rdf:RDF></x:xmpmeta>`,
  })
  eq(metadata.title, 'XMP Title', 'XMP title wins over Info')
  eq(metadata.author, 'Au', 'Info author decoded when XMP has none')
}

// ---------------------------------------------------------------------------
// 2. makePDF against the real fixtures
// ---------------------------------------------------------------------------
console.log('\n[2] makePDF (sample-metadata.pdf)')
{
  const file = readPdf('sample-metadata.pdf')
  const book = await makePDF(file)
  eq(book.rendition.layout, 'pre-paginated', 'rendition is pre-paginated')
  ok(book.rendition.viewport.width > 0 && book.rendition.viewport.height > 0,
    'first page viewport published for the renderer')
  eq(book.metadata.title, 'PDF Metadata', 'Info title')
  const author = Array.isArray(book.metadata.author) ? book.metadata.author.join(', ') : book.metadata.author
  eq(author, 'Readest', 'author (XMP may report a list; the importer joins it)')
  ok(book.sections.length > 0, `sections built (${book.sections.length})`)
  eq(book.sections[0].pageSpread, 'right', 'first page is its own spread (cover)')
  ok(book.sections.every(s => s.size === 1000), '每页 section size is the FXL unit')
  ok(typeof book.getCover === 'function' && typeof book.destroy === 'function',
    'cover + destroy hooks present')
  book.destroy()
}

console.log('\n[3] makePDF (sample-alice.pdf)')
{
  const file = readPdf('sample-alice.pdf')
  const book = await makePDF(file)
  const numPages = book.sections.length
  ok(numPages > 10, `page count from the file (${numPages})`)

  // TOC: every item that has a destination resolves to a page index
  const flat = []
  const walk = (items) => { for (const i of items ?? []) { flat.push(i); walk(i.subitems) } }
  walk(book.toc)
  ok(book.toc === null || flat.length > 0, `outline parsed (${flat.length} entries)`)
  ok(flat.every(i => Number.isInteger(i.index) || i.index === undefined),
    'outline entries carry page indices')
  ok(flat.every(i => i.index === undefined || (i.index >= 0 && i.index < numPages)),
    'page indices are inside the book')

  // Page labels: either null (labels restate physical numbers) or a full page list
  if (book.pageList) {
    eq(book.pageList.length, numPages, 'page list covers every page')
    ok(book.pageList.every((entry, i) => entry.index === i && entry.href === JSON.stringify(i)),
      'page list entries use the JSON page-index href')
  } else {
    ok(true, 'page labels collapsed to null (no meaningful labels in this file)')
  }

  // href resolution: page-list hrefs are JSON numbers, TOC hrefs are JSON dests
  const pageHref = JSON.stringify(3)
  eq((await book.resolveHref(pageHref)).index, 3, 'resolveHref on a JSON page index')
  eq((await book.splitTOCHref(pageHref))[0], 3, 'splitTOCHref on a JSON page index')
  const tocItem = flat.find(i => i.href && i.href !== '')
  if (tocItem) {
    const [toIndex] = await book.splitTOCHref(tocItem.href)
    ok(Number.isInteger(toIndex), 'splitTOCHref resolves an outline destination')
  }
  eq((await book.resolveHref('')).index, 0, 'empty href resolves to the first page')
  eq((await book.resolveHref('not json')).index, 0, 'malformed href does not throw')
  ok(book.isExternal('https://example.com'), 'isExternal detects absolute URLs')
  ok(!book.isExternal('4'), 'isExternal ignores page indices')
  eq(book.getTOCFragment({ documentElement: 'root' }), 'root', 'getTOCFragment is the page root')

  // createDocument: the text layer a search or TTS run walks
  const doc = await book.sections[3].createDocument()
  ok(!!doc.querySelector('.textLayer'), 'createDocument builds a .textLayer')
  ok(!!doc.querySelector('#canvas'), 'createDocument builds a #canvas host')
  ok(!!doc.querySelector('.annotationLayer'), 'createDocument builds a .annotationLayer')
  const text = doc.querySelector('.textLayer').textContent
  ok(text.trim().length > 100, `createDocument yields page text (${text.trim().length} chars)`)
  ok(/Alice/i.test(text) || /CHAPTER/i.test(text), 'page text is the one that was requested',
    text.slice(0, 80))
  const docAgain = await book.sections[3].createDocument()
  eq(docAgain.querySelector('.textLayer').textContent, text,
    'repeated createDocument yields identical text')

  book.destroy()
}

// ---------------------------------------------------------------------------
// 4. bounded range reads (readest #3470)
// ---------------------------------------------------------------------------
console.log('\n[4] range-read concurrency (readest #3470)')
{
  const bytes = readFileSync(join(FIXTURES, 'sample-alice.pdf'))
  const file = new window.File([bytes], 'sample-alice.pdf')
  let served = 0
  const transport = { onDataRange: () => { served++ }, requestDataRange: () => {} }
  let inFlight = 0
  let maxInFlight = 0
  const originalSlice = file.slice.bind(file)
  file.slice = (begin, end, type) => {
    inFlight++
    maxInFlight = Math.max(maxInFlight, inFlight)
    const blob = originalSlice(begin, end, type)
    const originalArrayBuffer = blob.arrayBuffer.bind(blob)
    blob.arrayBuffer = async () => {
      await new Promise(resolve => setTimeout(resolve, 1))
      try {
        return await originalArrayBuffer()
      } finally {
        inFlight--
      }
    }
    return blob
  }
  connectRangeTransport(file, transport)
  // A burst of the size pdf.js can fire while parsing a large PDF's
  // cross-reference and object streams.
  for (let i = 0; i < 200; i++) transport.requestDataRange(i * 100, i * 100 + 100)
  await new Promise(resolve => setTimeout(resolve, 1500))
  eq(served, 200, 'every requested range is served')
  ok(maxInFlight <= 6, `at most 6 reads in flight (peak ${maxInFlight})`)
  ok(maxInFlight > 1, `reads do overlap (peak ${maxInFlight})`)
  // A real file still parses through the throttled transport
  const book = await makePDF(new window.File([bytes], 'sample-alice.pdf'))
  ok(book.sections.length > 10, 'the throttled transport parses a real PDF')
  book.destroy()
}

// ---------------------------------------------------------------------------
// 5. pdf-text: line-break classification and reassembly
//    (cases ported from readest's src/__tests__/utils/pdfText.test.ts)
// ---------------------------------------------------------------------------
console.log('\n[5] pdf-text')
// Body text: 10px em, 12px line pitch, column spanning x 0..400.
const line = (text, overrides = {}) =>
  ({ text, left: 0, right: 400, top: 0, em: 10, firstWordWidth: 30, ...overrides })
const expectBreaks = (lines, expected, label) =>
  eq(classifyPdfLineBreaks(lines).join(','), expected.join(','), label)
{
  expectBreaks([
    line('If you are ever creating printed output, the most', { top: 0 }),
    line('accurate way to calibrate your monitor is to print a', { top: 12 }),
    line('test image first.', { top: 24, right: 120 }),
  ], ['space', 'space'], 'joins the wrapped lines of a justified paragraph with spaces')

  expectBreaks([
    line('side by side with printed output.', { top: 0, right: 250 }),
    line('If you are creating output for video or television,', { top: 12, firstWordWidth: 15 }),
  ], ['paragraph'], 'paragraph break after a short last line when the next word would have fit')

  expectBreaks([
    line('a ragged line that stops a little', { top: 0, right: 380 }),
    line('short because the next word is wide', { top: 12, right: 395, firstWordWidth: 40 }),
  ], ['space'], 'joins ragged-right lines whose next word would not have fit')

  expectBreaks([
    line('first line of paragraph one', { top: 0 }),
    line('second line of paragraph one', { top: 12 }),
    line('first line of paragraph two', { top: 30 }),
    line('second line of paragraph two', { top: 42 }),
  ], ['space', 'paragraph', 'space'], 'paragraph break across a larger-than-usual vertical gap')

  expectBreaks([
    line('Chapter Heading', { top: 0, em: 16, right: 200 }),
    line('Body text starts here and runs on', { top: 24 }),
  ], ['paragraph'], 'paragraph break when the font size changes')

  expectBreaks([
    line('The Title', { top: 0, left: 150, right: 250 }),
    line('by Someone', { top: 12, left: 130, right: 270 }),
  ], ['paragraph'], 'one line per centred line')

  expectBreaks([
    line('last line of column one is full', { top: 0 }),
    line('and continues here', { top: -300, left: 500, right: 700 }),
  ], ['space'], 'continues a paragraph into the next column when the line is full')

  expectBreaks([
    line('A full-width title over two columns', { top: 0, em: 16, right: 900 }),
    line('first column line one', { top: 30 }),
    line('first column line two', { top: 42 }),
  ], ['paragraph', 'space'], 'ignores wider lines of another font when measuring the column')

  expectBreaks([
    line('body line at the column edge', { top: 0 }),
    line('another body line at the edge', { top: 12 }),
    line('double-space your paper. True-Type 1 fonts are preferred.', { top: 24, right: 391 }),
    line('The first paragraph in each section should not be', { top: 36, left: 16, firstWordWidth: 13 }),
    line('indented, but all following paragraphs within the', { top: 48 }),
  ], ['space', 'space', 'paragraph', 'space'], 'paragraph break before an indented first line')

  expectBreaks([
    line('body text at the column edge runs long', { top: 0 }),
    line('more body text at the column edge here', { top: 12 }),
    line('and a third body line at the column edge', { top: 24 }),
    line('- a bulleted item that is long enough to wrap', { top: 36, left: 15 }),
    line('onto a second line, indented past the bullet', { top: 48, left: 25, right: 300 }),
    line('- the next bullet', { top: 60, left: 15, right: 150 }),
  ], ['space', 'space', 'paragraph', 'space', 'paragraph'], 'no break before a list item continuation')

  expectBreaks([
    line('[1] A. Author, "A long reference title that', { top: 0 }),
    line('wraps onto a second line and then a third', { top: 12, left: 15 }),
    line('one," Journal, 2020.', { top: 24, left: 15, right: 150 }),
    line('[2] B. Author, "Another long reference that', { top: 36 }),
    line('wraps onto a second line and then a third', { top: 48, left: 15 }),
    line('one," Journal, 2021.', { top: 60, left: 15, right: 150 }),
  ], ['space', 'space', 'paragraph', 'space', 'space'], 'hanging-indent continuations are line wraps')

  expectBreaks([
    line('left cell', { top: 0, right: 100 }),
    line('right cell', { top: 0, left: 150, right: 250 }),
  ], ['space'], 'continues two runs of the same printed line')

  expectBreaks([
    line('the calibra-', { top: 0 }),
    line('tion will never', { top: 12 }),
    line('like Wi-', { top: 24 }),
    line('Fi and soft\u00AD', { top: 36 }),
    line('hyphen', { top: 48 }),
  ], ['dehyphenate', 'space', 'join', 'dehyphenate'], 'hyphen and soft hyphen handling')

  expectBreaks([
    line('这是第一行文字，', { top: 0 }),
    line('这是第二行文字。', { top: 12 }),
  ], ['join'], 'joins CJK lines without a space')

  expectBreaks([
    line('trailing space ', { top: 0 }),
    line('next line', { top: 12 }),
  ], ['join'], 'does not add a space when the seam already has one')

  expectBreaks([
    line('no layout', { em: 0 }),
    line('at all', { em: 0 }),
  ], ['paragraph'], 'falls back to line breaks when there is no geometry')
}
{
  // getPdfTextFromRange over a two-paragraph text layer
  const textLayer = window.document.createElement('div')
  textLayer.className = 'textLayer'
  const makeSpan = (text, left, top, width, height = 10) => {
    const span = window.document.createElement('span')
    span.setAttribute('role', 'presentation')
    span.textContent = text
    span.getBoundingClientRect = () => ({
      left, top, right: left + width, bottom: top + height, width, height, x: left, y: top,
    })
    textLayer.append(span)
    return span
  }
  const makeBr = () => {
    const br = window.document.createElement('br')
    br.setAttribute('role', 'presentation')
    textLayer.append(br)
    return br
  }
  // Paragraph one wraps onto a second line; paragraph two starts after a gap.
  makeSpan('If you are ever creating printed output, the most accurate', 0, 0, 390)
  makeBr()
  makeSpan('way to calibrate your monitor is to print a test image first.', 0, 12, 380)
  makeBr()
  makeSpan('The second paragraph starts here.', 0, 36, 200)
  makeBr()
  window.document.body.append(textLayer)

  const rangeOf = (startNode, startOffset, endNode, endOffset) => {
    const range = window.document.createRange()
    range.setStart(startNode, startOffset)
    range.setEnd(endNode, endOffset)
    return range
  }
  const spans = textLayer.querySelectorAll('span')
  const firstSpanText = spans[0].firstChild
  const secondSpanText = spans[1].firstChild
  const thirdSpanText = spans[2].firstChild

  const wrapped = rangeOf(firstSpanText, 0, secondSpanText, secondSpanText.data.length)
  eq(getPdfTextFromRange(wrapped, textLayer),
    'If you are ever creating printed output, the most accurate way to calibrate your monitor is to print a test image first.',
    'a wrapped line is joined with a space')
  eq(getSelectionText(wrapped), getPdfTextFromRange(wrapped, textLayer),
    'getSelectionText routes a text-layer selection through the reassembly')

  const acrossParagraphs = rangeOf(firstSpanText, 0, thirdSpanText, thirdSpanText.data.length)
  ok(getPdfTextFromRange(acrossParagraphs, textLayer).includes('\nThe second paragraph'),
    'a paragraph gap is kept as a line break')

  const partial = rangeOf(firstSpanText, 5, firstSpanText, 20)
  eq(getPdfTextFromRange(partial, textLayer),
    'If you are ever creating printed output, the most accurate'.slice(5, 20),
    'only the selected slice of a line is returned')

  // A hyphenated wrap drops the hyphen
  const hyphenLayer = window.document.createElement('div')
  hyphenLayer.className = 'textLayer'
  const hySpan = (text, left, top, width) => {
    const span = window.document.createElement('span')
    span.textContent = text
    span.getBoundingClientRect = () => ({
      left, top, right: left + width, bottom: top + 10, width, height: 10, x: left, y: top,
    })
    hyphenLayer.append(span)
    return span
  }
  hySpan('the calibra-', 0, 0, 200)
  const hyBr = window.document.createElement('br')
  hyphenLayer.append(hyBr)
  hySpan('tion will never', 0, 12, 200)
  window.document.body.append(hyphenLayer)
  const hyRange = rangeOf(hyphenLayer.querySelectorAll('span')[0].firstChild, 0,
    hyphenLayer.querySelectorAll('span')[1].firstChild, 'tion will never'.length)
  eq(getPdfTextFromRange(hyRange, hyphenLayer), 'the calibration will never',
    'a hyphenated wrap rejoins the word')

  textLayer.remove()
  hyphenLayer.remove()
}

// ---------------------------------------------------------------------------
// 6. per-page CFIs (the anchors a PDF bookmark/highlight is stored under)
// ---------------------------------------------------------------------------
console.log('\n[6] fake CFIs')
{
  for (const index of [0, 1, 3, 10]) {
    const cfi = CFI.fake.fromIndex(index)
    eq(CFI.fake.toIndex(CFI.parse(cfi).shift()), index, `fake CFI round-trips page ${index} (${cfi})`)
  }
  eq(CFI.fake.fromIndex(0), 'epubcfi(/6/2)', 'page 0 anchor')
  eq(CFI.fake.fromIndex(3), 'epubcfi(/6/8)', 'page 3 anchor is spine step 8')
}

console.log(`\n${failures ? 'FAILED' : 'PASSED'}: ${checks - failures}/${checks} checks`)
process.exit(failures ? 1 : 0)
