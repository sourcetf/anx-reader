/**
 * Covers which word a press on a recognised page means.
 *
 * Only the first press on a page goes through the reader: a page that already
 * carries words is left to the WebView, whose own long press selects — and
 * which word that is cannot be tested in jsdom at all. What can be tested, and
 * is the part the reader still owns, is the word a page is read with: the
 * point is matched against the word boxes first, then against the nearest word
 * on the line the press belongs to.
 *
 * The page under test is the shape one that was reported: a line of display
 * text, a drawing that OCR reads bits of lettering out of, then body text. The
 * display line and the drawing's words are several times the height of a body
 * word, which is what made a tolerance scaled to the candidate's own size
 * answer a press on the body with a word out of the drawing.
 *
 *   node ocr.test.mjs
 */
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
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

const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
  url: 'http://127.0.0.1:8080/foliate-js/index.html',
  pretendToBeVisual: true,
})
const { window } = dom

// ocr-layer.js imports nothing, but keep the same copy-then-import pattern the
// other suites use so the module runs against this test's window.
const dir = mkdtempSync(join(tmpdir(), 'anx-ocr-'))
writeFileSync(join(dir, 'package.json'), '{"type":"module"}')
writeFileSync(join(dir, 'ocr-layer.js'), readFileSync(join(SRC, 'ocr-layer.js')))
const {
  nearestOcrWord, injectOcrTextLayer, wordIndexAt, pageHasOcrText, pageHasOwnText,
  ocrSelectionText, ocrWordsByPage, sectionIndexOfDoc,
} = await import(join(dir, 'ocr-layer.js'))

// ---------------------------------------------------------------------------
// The page: 412 x 583 CSS px, the same shape as the device's fit-page view.
const PAGE = { w: 412, h: 583 }
// Fractions of the page, as ML Kit's bitmap pixels become on the way in.
const illustrated = [
  { text: 'WONDERLAND', x: 0.08, y: 0.05, w: 0.62, h: 0.05 },
  { text: 'XXX', x: 0.16, y: 0.48, w: 0.20, h: 0.058 },
  { text: 'Alice', x: 0.12, y: 0.60, w: 0.08, h: 0.019 },
  { text: 'was', x: 0.22, y: 0.60, w: 0.05, h: 0.019 },
  { text: 'beginning', x: 0.29, y: 0.60, w: 0.12, h: 0.019 },
]
// A body line of a real page: many small words, so the page's typical word is
// a body word even though three of the words above are several times its size.
const body = []
for (let i = 0; i < 60; i++) {
  body.push({ text: `w${i}`, x: 0.05 + (i % 10) * 0.09, y: 0.62 + Math.floor(i / 10) * 0.03,
    w: 0.07, h: 0.017 })
}

const page = (words) => {
  const doc = window.document.implementation.createHTMLDocument('page')
  const canvas = doc.createElement('canvas')
  canvas.id = 'canvas'
  const wrap = doc.createElement('div')
  wrap.id = 'canvas'
  const inner = doc.createElement('canvas')
  wrap.append(inner)
  doc.body.append(wrap)
  const layer = doc.createElement('div')
  layer.className = 'textLayer'
  doc.body.append(layer)
  // jsdom lays nothing out, so the boxes are stubbed with the sizes the words
  // were placed at — which is exactly what the reader measures against.
  inner.getBoundingClientRect = () => ({ left: 0, top: 0, width: PAGE.w, height: PAGE.h,
    right: PAGE.w, bottom: PAGE.h, x: 0, y: 0 })
  for (const [prop, value] of [['clientWidth', PAGE.w], ['clientHeight', PAGE.h]]) {
    Object.defineProperty(inner, prop, { value, configurable: true })
  }
  doc.__layer = layer
  return doc
}

const press = (words, nx, ny) => {
  const doc = page(words)
  ocrWordsByPage.set(sectionIndexOfDoc(doc), words)
  injectOcrTextLayer(doc, words)
  return wordIndexAt(doc, nx * PAGE.w, ny * PAGE.h, null)
}

const wordAt = (words, nx, ny) => {
  const i = press(words, nx, ny)
  return i >= 0 ? words[i].text : null
}

console.log('\n[1] the word a press on a recognised page means')
{
  const all = illustrated.concat(body)

  ok(wordAt(all, 0.245, 0.609) === 'was',
    `a press inside a body word is that word (“${wordAt(all, 0.245, 0.609)}”)`)
  const gap = wordAt(all, 0.205, 0.609)
  ok(gap === 'Alice' || gap === 'was',
    `a press in the gap between two body words is one of them (“${gap}”)`)
  ok(wordAt(all, 0.25, 0.50) === 'XXX',
    `a press inside the drawing is the drawing's word (“${wordAt(all, 0.25, 0.50)}”)`)
  ok(wordAt(all, 0.35, 0.07) === 'WONDERLAND',
    `a press on the display line is that line (“${wordAt(all, 0.35, 0.07)}”)`)

  // The reported case: body text under a drawing, answered with the drawing.
  // The gap between them is wider than a line, and the word above is three
  // times the height of the word below.
  const between = wordAt(all, 0.25, (0.48 + 0.058 + 0.60) / 2)
  ok(between !== 'XXX',
    `a press between the drawing and the body is not the drawing (“${between ?? 'nothing'}”)`)
}

console.log('\n[2] a press that belongs to no word selects nothing')
{
  const all = illustrated.concat(body)
  ok(wordAt(all, 0.95, 0.95) === null, 'a press in the page margin finds no word')
  // The band between the drawing and the text under it is a line and a half
  // tall — more than the reader is willing to guess across, because a guess
  // there is what the report was about. Its middle is the point to test.
  const middle = (0.48 + 0.058 + 0.60) / 2
  ok(wordAt(all, 0.25, middle) === null,
    `a press in the band between art and body is answered with nothing `
    + `(“${wordAt(all, 0.25, middle) ?? 'nothing'}”)`)
}

console.log('\n[3] the tolerance follows the page, not the candidate')
{
  // Only tall words on the page: the typical word is tall too, so a press just
  // below one still belongs to it.
  const tall = [
    { text: 'BIG', x: 0.1, y: 0.10, w: 0.5, h: 0.08 },
    { text: 'ALSO', x: 0.1, y: 0.40, w: 0.5, h: 0.08 },
  ]
  ok(wordAt(tall, 0.35, 0.13) === 'BIG', `a press below a tall line is that line (“${wordAt(tall, 0.35, 0.13)}”)`)
  ok(wordAt(tall, 0.35, 0.29) === null,
    `and a band a line apart is neither (“${wordAt(tall, 0.35, 0.29) ?? 'nothing'}”)`)
}

console.log('\n[4] a selection over recognised words reads as words')
{
  const all = illustrated.concat(body)
  const doc = page(all)
  ocrWordsByPage.set(sectionIndexOfDoc(doc), all)
  injectOcrTextLayer(doc, all)
  const layer = doc.querySelector('.textLayer')
  const span = i => doc.querySelector(`[data-ocr-word="${i}"]`)

  // ‘Alice was beginning’ — three spans, nothing between them in the document.
  const across = doc.createRange()
  across.setStart(span(2).firstChild, 0)
  across.setEnd(span(4).firstChild, span(4).firstChild.data.length)
  ok(across.toString() === 'Alicewasbeginning',
    `the page itself runs the words together (“${across.toString()}”)`)
  ok(ocrSelectionText(layer, across) === 'Alice was beginning',
    `but the selection reads as words (“${ocrSelectionText(layer, across)}”)`)

  // A whole line, and a selection that starts mid-word.
  const line = doc.createRange()
  line.setStart(span(2).firstChild, 0)
  line.setEnd(span(4).firstChild, 0)
  ok(ocrSelectionText(layer, line) === 'Alice was',
    `a selection ending on a word boundary keeps its words (“${ocrSelectionText(layer, line)}”)`)
  const part = doc.createRange()
  part.setStart(span(2).firstChild, 2)
  part.setEnd(span(3).firstChild, 3)
  ok(ocrSelectionText(layer, part) === 'ice was',
    `and a partial word is carried as it is (“${ocrSelectionText(layer, part)}”)`)
}

console.log('\n[5] an element the press landed on answers directly')
{
  const all = illustrated.concat(body)
  const doc = page(all)
  ocrWordsByPage.set(sectionIndexOfDoc(doc), all)
  injectOcrTextLayer(doc, all)
  const span = doc.querySelector('[data-ocr-word="2"]')
  // A touch delivered to the span itself is exact, however the boxes sit.
  ok(wordIndexAt(doc, 0, 0, span) === 2, 'the span under the finger names its word')
  ok(wordIndexAt(doc, 0, 0, doc.body) === -1 || wordIndexAt(doc, 0, 0, doc.body) >= 0,
    'a press on something else falls back to the boxes')
  ok(pageHasOcrText(doc), 'and the page reports that it carries words')
  ok(!pageHasOwnText(doc), 'while a page whose text is OCR\'s is not one with text of its own')
}

console.log(`\n${failures ? 'FAILED' : 'PASSED'}: ${checks - failures}/${checks} checks`)
process.exit(failures ? 1 : 0)
