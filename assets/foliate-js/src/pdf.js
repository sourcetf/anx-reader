/* global pdfjsLib */
import { restoreOcrWords } from './ocr-layer.js'

// https://github.com/mozilla/pdf.js/blob/f04967017f22e46d70d11468dd928b4cdc2f6ea1/web/text_layer_builder.css
const textLayerBuilderCSS = `
/* Copyright 2014 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

:root {
  --highlight-bg-color: rgb(180 0 170);
  --highlight-selected-bg-color: rgb(0 100 0);
}

@media screen and (forced-colors: active) {
  :root {
    --highlight-bg-color: Highlight;
    --highlight-selected-bg-color: ButtonText;
  }
}

.textLayer {
  position: absolute;
  text-align: initial;
  inset: 0;
  overflow: hidden;
  opacity: 0.25;
  line-height: 1;
  text-size-adjust: none;
  forced-color-adjust: none;
  transform-origin: 0 0;
  z-index: 2;
}

.textLayer :is(span, br) {
  color: transparent;
  position: absolute;
  white-space: pre;
  cursor: text;
  transform-origin: 0% 0%;
}

/* Only necessary in Google Chrome, see issue 14205, and most unfortunately
 * the problem doesn't show up in "text" reference tests. */
/*#if !MOZCENTRAL*/
.textLayer span.markedContent {
  top: 0;
  height: 0;
}
/*#endif*/

.textLayer .highlight {
  margin: -1px;
  padding: 1px;
  background-color: var(--highlight-bg-color);
  border-radius: 4px;
}

.textLayer .highlight.appended {
  position: initial;
}

.textLayer .highlight.begin {
  border-radius: 4px 0 0 4px;
}

.textLayer .highlight.end {
  border-radius: 0 4px 4px 0;
}

.textLayer .highlight.middle {
  border-radius: 0;
}

.textLayer .highlight.selected {
  background-color: var(--highlight-selected-bg-color);
}

.textLayer ::selection {
  /*#if !MOZCENTRAL*/
  background: blue;
  /*#endif*/
  background: AccentColor; /* stylelint-disable-line declaration-block-no-duplicate-properties */
}

/* Avoids https://github.com/mozilla/pdf.js/issues/13840 in Chrome */
/*#if !MOZCENTRAL*/
.textLayer br::selection {
  background: transparent;
}
/*#endif*/

.textLayer .endOfContent {
  display: block;
  position: absolute;
  inset: 100% 0 0;
  z-index: -1;
  cursor: default;
  user-select: none;
}

.textLayer .endOfContent.active {
  top: 0;
}
`

//https://github.com/mozilla/pdf.js/blob/d64f223d034ad74fb62571c3acff566d25eca413/web/annotation_layer_builder.css
const annotationLayerBuilderCSS = `
/* Copyright 2014 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

:root {
  --annotation-unfocused-field-background: url("data:image/svg+xml;charset=UTF-8,<svg width='1px' height='1px' xmlns='http://www.w3.org/2000/svg'><rect width='100%' height='100%' style='fill:rgba(0, 54, 255, 0.13);'/></svg>");
  --input-focus-border-color: Highlight;
  --input-focus-outline: 1px solid Canvas;
  --input-unfocused-border-color: transparent;
  --input-disabled-border-color: transparent;
  --input-hover-border-color: black;
  --link-outline: none;
}

@media screen and (forced-colors: active) {
  :root {
    --input-focus-border-color: CanvasText;
    --input-unfocused-border-color: ActiveText;
    --input-disabled-border-color: GrayText;
    --input-hover-border-color: Highlight;
    --link-outline: 1.5px solid LinkText;
    --hcm-highligh-filter: invert(100%);
  }
  .annotationLayer .textWidgetAnnotation :is(input, textarea):required,
  .annotationLayer .choiceWidgetAnnotation select:required,
  .annotationLayer
    .buttonWidgetAnnotation:is(.checkBox, .radioButton)
    input:required {
    outline: 1.5px solid selectedItem;
  }

  .annotationLayer .linkAnnotation:hover {
    backdrop-filter: var(--hcm-highligh-filter);
  }

  .annotationLayer .linkAnnotation > a:hover {
    opacity: 0 !important;
    background: none !important;
    box-shadow: none;
  }

  .annotationLayer .popupAnnotation .popup {
    outline: calc(1.5px * var(--scale-factor)) solid CanvasText !important;
    background-color: ButtonFace !important;
    color: ButtonText !important;
  }

  .annotationLayer .highlightArea:hover::after {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    backdrop-filter: var(--hcm-highligh-filter);
    content: "";
    pointer-events: none;
  }

  .annotationLayer .popupAnnotation.focused .popup {
    outline: calc(3px * var(--scale-factor)) solid Highlight !important;
  }
}

.annotationLayer {
  position: absolute;
  top: 0;
  left: 0;
  pointer-events: none;
  transform-origin: 0 0;
  z-index: 3;
}

.annotationLayer[data-main-rotation="90"] .norotate {
  transform: rotate(270deg) translateX(-100%);
}
.annotationLayer[data-main-rotation="180"] .norotate {
  transform: rotate(180deg) translate(-100%, -100%);
}
.annotationLayer[data-main-rotation="270"] .norotate {
  transform: rotate(90deg) translateY(-100%);
}

.annotationLayer canvas {
  position: absolute;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.annotationLayer section {
  position: absolute;
  text-align: initial;
  pointer-events: auto;
  box-sizing: border-box;
  transform-origin: 0 0;
}

.annotationLayer .linkAnnotation {
  outline: var(--link-outline);
}

.annotationLayer :is(.linkAnnotation, .buttonWidgetAnnotation.pushButton) > a {
  position: absolute;
  font-size: 1em;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.annotationLayer
  :is(.linkAnnotation, .buttonWidgetAnnotation.pushButton):not(.hasBorder)
  > a:hover {
  opacity: 0.2;
  background-color: rgb(255 255 0);
  box-shadow: 0 2px 10px rgb(255 255 0);
}

.annotationLayer .linkAnnotation.hasBorder:hover {
  background-color: rgb(255 255 0 / 0.2);
}

.annotationLayer .hasBorder {
  background-size: 100% 100%;
}

.annotationLayer .textAnnotation img {
  position: absolute;
  cursor: pointer;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
}

.annotationLayer .textWidgetAnnotation :is(input, textarea),
.annotationLayer .choiceWidgetAnnotation select,
.annotationLayer .buttonWidgetAnnotation:is(.checkBox, .radioButton) input {
  background-image: var(--annotation-unfocused-field-background);
  border: 2px solid var(--input-unfocused-border-color);
  box-sizing: border-box;
  font: calc(9px * var(--scale-factor)) sans-serif;
  height: 100%;
  margin: 0;
  vertical-align: top;
  width: 100%;
}

.annotationLayer .textWidgetAnnotation :is(input, textarea):required,
.annotationLayer .choiceWidgetAnnotation select:required,
.annotationLayer
  .buttonWidgetAnnotation:is(.checkBox, .radioButton)
  input:required {
  outline: 1.5px solid red;
}

.annotationLayer .choiceWidgetAnnotation select option {
  padding: 0;
}

.annotationLayer .buttonWidgetAnnotation.radioButton input {
  border-radius: 50%;
}

.annotationLayer .textWidgetAnnotation textarea {
  resize: none;
}

.annotationLayer .textWidgetAnnotation :is(input, textarea)[disabled],
.annotationLayer .choiceWidgetAnnotation select[disabled],
.annotationLayer
  .buttonWidgetAnnotation:is(.checkBox, .radioButton)
  input[disabled] {
  background: none;
  border: 2px solid var(--input-disabled-border-color);
  cursor: not-allowed;
}

.annotationLayer .textWidgetAnnotation :is(input, textarea):hover,
.annotationLayer .choiceWidgetAnnotation select:hover,
.annotationLayer
  .buttonWidgetAnnotation:is(.checkBox, .radioButton)
  input:hover {
  border: 2px solid var(--input-hover-border-color);
}
.annotationLayer .textWidgetAnnotation :is(input, textarea):hover,
.annotationLayer .choiceWidgetAnnotation select:hover,
.annotationLayer .buttonWidgetAnnotation.checkBox input:hover {
  border-radius: 2px;
}

.annotationLayer .textWidgetAnnotation :is(input, textarea):focus,
.annotationLayer .choiceWidgetAnnotation select:focus {
  background: none;
  border: 2px solid var(--input-focus-border-color);
  border-radius: 2px;
  outline: var(--input-focus-outline);
}

.annotationLayer .buttonWidgetAnnotation:is(.checkBox, .radioButton) :focus {
  background-image: none;
  background-color: transparent;
}

.annotationLayer .buttonWidgetAnnotation.checkBox :focus {
  border: 2px solid var(--input-focus-border-color);
  border-radius: 2px;
  outline: var(--input-focus-outline);
}

.annotationLayer .buttonWidgetAnnotation.radioButton :focus {
  border: 2px solid var(--input-focus-border-color);
  outline: var(--input-focus-outline);
}

.annotationLayer .buttonWidgetAnnotation.checkBox input:checked::before,
.annotationLayer .buttonWidgetAnnotation.checkBox input:checked::after,
.annotationLayer .buttonWidgetAnnotation.radioButton input:checked::before {
  background-color: CanvasText;
  content: "";
  display: block;
  position: absolute;
}

.annotationLayer .buttonWidgetAnnotation.checkBox input:checked::before,
.annotationLayer .buttonWidgetAnnotation.checkBox input:checked::after {
  height: 80%;
  left: 45%;
  width: 1px;
}

.annotationLayer .buttonWidgetAnnotation.checkBox input:checked::before {
  transform: rotate(45deg);
}

.annotationLayer .buttonWidgetAnnotation.checkBox input:checked::after {
  transform: rotate(-45deg);
}

.annotationLayer .buttonWidgetAnnotation.radioButton input:checked::before {
  border-radius: 50%;
  height: 50%;
  left: 30%;
  top: 20%;
  width: 50%;
}

.annotationLayer .textWidgetAnnotation input.comb {
  font-family: monospace;
  padding-left: 2px;
  padding-right: 0;
}

.annotationLayer .textWidgetAnnotation input.comb:focus {
  /*
   * Letter spacing is placed on the right side of each character. Hence, the
   * letter spacing of the last character may be placed outside the visible
   * area, causing horizontal scrolling. We avoid this by extending the width
   * when the element has focus and revert this when it loses focus.
   */
  width: 103%;
}

.annotationLayer .buttonWidgetAnnotation:is(.checkBox, .radioButton) input {
  appearance: none;
}

.annotationLayer .fileAttachmentAnnotation .popupTriggerArea {
  height: 100%;
  width: 100%;
}

.annotationLayer .popupAnnotation {
  position: absolute;
  font-size: calc(9px * var(--scale-factor));
  pointer-events: none;
  width: max-content;
  max-width: 45%;
  height: auto;
}

.annotationLayer .popup {
  background-color: rgb(255 255 153);
  box-shadow: 0 calc(2px * var(--scale-factor)) calc(5px * var(--scale-factor))
    rgb(136 136 136);
  border-radius: calc(2px * var(--scale-factor));
  outline: 1.5px solid rgb(255 255 74);
  padding: calc(6px * var(--scale-factor));
  cursor: pointer;
  font: message-box;
  white-space: normal;
  word-wrap: break-word;
  pointer-events: auto;
}

.annotationLayer .popupAnnotation.focused .popup {
  outline-width: 3px;
}

.annotationLayer .popup * {
  font-size: calc(9px * var(--scale-factor));
}

.annotationLayer .popup > .header {
  display: inline-block;
}

.annotationLayer .popup > .header h1 {
  display: inline;
}

.annotationLayer .popup > .header .popupDate {
  display: inline-block;
  margin-left: calc(5px * var(--scale-factor));
  width: fit-content;
}

.annotationLayer .popupContent {
  border-top: 1px solid rgb(51 51 51);
  margin-top: calc(2px * var(--scale-factor));
  padding-top: calc(2px * var(--scale-factor));
}

.annotationLayer .richText > * {
  white-space: pre-wrap;
  font-size: calc(9px * var(--scale-factor));
}

.annotationLayer .popupTriggerArea {
  cursor: pointer;
}

.annotationLayer section svg {
  position: absolute;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
}

.annotationLayer .annotationTextContent {
  position: absolute;
  width: 100%;
  height: 100%;
  opacity: 0;
  color: transparent;
  user-select: none;
  pointer-events: none;
}

.annotationLayer .annotationTextContent span {
  width: 100%;
  display: inline-block;
}

.annotationLayer svg.quadrilateralsContainer {
  contain: strict;
  width: 0;
  height: 0;
  position: absolute;
  top: 0;
  left: 0;
  z-index: -1;
}
`

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

// Where the pdf.js runtime data files (pre-defined CMaps for CJK-composite
// fonts, standard font programs) are served from. Resolved against the reader
// page so both the ES-module and the legacy bundle paths find them.
const pdfjsVendorPath = path => new URL(`vendor/pdfjs/${path}`, document.baseURI).href

/** @typedef {string | number[] | Uint8Array | null | undefined} PDFMetadataValue */
/** @typedef {Record<string, PDFMetadataValue>} PDFInfo */

// PDF 32000-1, Table D.2. This mirrors pdf.js's stringToPDFString so Info
// dictionary values read natively have the same Unicode representation as
// values returned by PDFDocumentProxy.getMetadata().
const PDF_STRING_TRANSLATE_TABLE = [
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0x2d8, 0x2c7, 0x2c6, 0x2d9, 0x2dd, 0x2db, 0x2da, 0x2dc,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0x2022, 0x2020, 0x2021, 0x2026, 0x2014, 0x2013, 0x192, 0x2044,
    0x2039, 0x203a, 0x2212, 0x2030, 0x201e, 0x201c, 0x201d, 0x2018,
    0x2019, 0x201a, 0x2122, 0xfb01, 0xfb02, 0x141, 0x152, 0x160,
    0x178, 0x17d, 0x131, 0x142, 0x153, 0x161, 0x17e, 0, 0x20ac,
]

/** @param {number[] | Uint8Array} value */
const toUint8Array = value => value instanceof Uint8Array ? value : new Uint8Array(value)

const removeEscapeSequences = value => {
    let result = ''
    let escaping = false
    for (const char of value) {
        if (char.charCodeAt(0) === 0x1b) {
            escaping = !escaping
        } else if (!escaping) {
            result += char
        }
    }
    return result
}

/** @param {PDFMetadataValue} value */
export const decodePDFString = value => {
    if (value == null || typeof value === 'string') return value
    let bytes = toUint8Array(value)
    let encoding
    if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be'
    else if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le'
    else if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) encoding = 'utf-8'
    if (encoding) {
        if (encoding.startsWith('utf-16') && bytes.length % 2 === 1) bytes = bytes.slice(0, -1)
        try {
            return removeEscapeSequences(new TextDecoder(encoding, { fatal: true }).decode(bytes))
        } catch {
            // Match pdf.js: fall through to PDFDocEncoding when BOM decoding fails.
        }
    }
    const chars = []
    for (let i = 0; i < bytes.length; i++) {
        const byte = bytes[i]
        if (byte === 0x1b) {
            while (++i < bytes.length && bytes[i] !== 0x1b) {
                // Skip the escape sequence.
            }
            continue
        }
        const code = PDF_STRING_TRANSLATE_TABLE[byte]
        chars.push(String.fromCharCode(code || byte))
    }
    return chars.join('')
}

/** @param {PDFMetadataValue} value */
const decodeXMP = value => {
    if (!value) return null
    const raw = typeof value === 'string'
        ? value
        : new TextDecoder('utf-8').decode(toUint8Array(value))
    return raw.replace(/^[^<]+/, '').replaceAll(/>\\376\\377([^<]+)/g, (all, codes) => {
        const bytes = codes.replaceAll(/\\([0-3])([0-7])([0-7])/g,
            (code, d1, d2, d3) => String.fromCharCode(d1 * 64 + d2 * 8 + d3))
            .replaceAll(/&(amp|apos|gt|lt|quot);/g, (str, name) => ({
                amp: '&', apos: "'", gt: '>', lt: '<', quot: '"',
            })[name])
        const chars = ['>']
        for (let i = 0; i < bytes.length; i += 2) {
            const code = bytes.charCodeAt(i) * 256 + bytes.charCodeAt(i + 1)
            chars.push(code >= 32 && code < 127 && code !== 60 && code !== 62 && code !== 38
                ? String.fromCharCode(code)
                : `&#x${(0x10000 + code).toString(16).substring(1)};`)
        }
        return chars.join('')
    })
}

const DC_NS = 'http://purl.org/dc/elements/1.1/'
const RDF_NS = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'
const CALIBRE_NS = 'http://calibre-ebook.com/xmp-namespace'
const CALIBRE_SI_NS = 'http://calibre-ebook.com/xmp-namespace-series-index'

const parseXMP = raw => {
    if (!raw) return { doc: null, values: new Map() }
    let doc
    try {
        doc = new DOMParser().parseFromString(raw, 'application/xml')
    } catch {
        return { doc: null, values: new Map() }
    }
    if (doc.getElementsByTagName('parsererror').length) {
        return { doc: null, values: new Map() }
    }
    const values = new Map()
    for (const description of doc.getElementsByTagNameNS(RDF_NS, 'Description')) {
        for (const entry of description.children) {
            if (entry.namespaceURI !== DC_NS) continue
            const name = `dc:${entry.localName.toLowerCase()}`
            if (name === 'dc:creator' || name === 'dc:subject') {
                const container = entry.firstElementChild
                const items = container
                    ? Array.from(container.children)
                        .filter(item => item.namespaceURI === RDF_NS && item.localName === 'li')
                        .map(item => item.textContent.trim())
                    : []
                values.set(name, items)
            } else {
                values.set(name, entry.textContent.trim())
            }
        }
    }
    return { doc, values }
}

const getInfo = (info, name) =>
    decodePDFString(info?.[name] ?? info?.[name.toLowerCase()]) ?? undefined

const getCalibreSeries = doc => {
    const series = doc?.getElementsByTagNameNS(CALIBRE_NS, 'series').item(0)
    const name = series?.getElementsByTagNameNS(RDF_NS, 'value').item(0)?.textContent?.trim()
    if (!name) return null
    const position = series.getElementsByTagNameNS(CALIBRE_SI_NS, 'series_index')
        .item(0)?.textContent?.trim()
    return position ? { name, position } : { name }
}

/**
 * Normalize PDF Info/XMP into the metadata shape used by the reader.
 * @param {{ info?: PDFInfo, xmp?: PDFMetadataValue }} [input]
 */
export const parsePDFMetadata = ({ info = {}, xmp = null } = {}) => {
    const raw = decodeXMP(xmp)
    const { doc, values } = parseXMP(raw)
    const metadata = {
        title: values.get('dc:title') ?? getInfo(info, 'Title'),
        author: values.get('dc:creator') ?? getInfo(info, 'Author'),
        contributor: values.get('dc:contributor'),
        description: values.get('dc:description') ?? getInfo(info, 'Subject'),
        language: values.get('dc:language'),
        publisher: values.get('dc:publisher'),
        subject: values.get('dc:subject'),
        identifier: values.get('dc:identifier'),
        source: values.get('dc:source'),
        rights: values.get('dc:rights'),
    }
    const series = getCalibreSeries(doc)
    if (series) metadata.belongsTo = { series }
    return metadata
}

// ---------------------------------------------------------------------------
// Page rendering
// ---------------------------------------------------------------------------

// The OS accessibility "font size" setting scales every piece of WebView-rendered
// text (including this transparent selection/highlight text layer) but leaves the
// page's canvas bitmap untouched. Only the glyph *size* (a font-size) is scaled;
// the text layer's positions are percentages of the container and are not. Left
// uncorrected the glyphs render `fontScale`x larger than the ones baked into the
// canvas, so selection and highlight rectangles overshoot the text into the blank
// margins and sit too low (readest #4480). Measure the scale here so render() can
// divide it back out of the glyph size only. offsetHeight of a 100px/line-height-1
// box reflects the OS font scaling but not devicePixelRatio or CSS transforms, so
// it isolates it.
const getFontScale = doc => {
    const probe = doc.createElement('div')
    probe.style.cssText = 'position:absolute;left:-9999px;top:0;visibility:hidden;'
        + 'font-size:100px;line-height:1;text-size-adjust:none;-webkit-text-size-adjust:none'
    probe.textContent = 'x'
    doc.body.append(probe)
    const fontScale = probe.offsetHeight / 100
    probe.remove()
    return fontScale > 0 ? fontScale : 1
}

// Track active render tasks per iframe document to cancel superseded renders
const activeRenderTasks = new WeakMap()
// Generation counter per document to detect stale renders after async gaps
const renderGenerations = new WeakMap()
// What each document was last rendered for, so an identical re-render can be
// skipped instead of rebuilding the text layer (see `render`)
const renderedFor = new WeakMap()

// Set up panning and selection event handlers once per iframe document
export const setupPanningEvents = (doc) => {
    if (doc._readestEventsInitialized) return
    doc._readestEventsInitialized = true

    const container = doc.querySelector('.textLayer')
    if (!container) return

    let isPanning = false
    // A press only becomes a pan once the finger has actually moved: a long press
    // drifts by a pixel or two, and treating that as a pan would preventDefault
    // the press away and cancel text selection (and the menu that follows it).
    let pendingPan = false
    const PAN_THRESHOLD = 8
    let startX = 0
    let startY = 0
    let scrollLeft = 0
    let scrollTop = 0
    let scrollParent = null

    const findScrollableParent = (element) => {
        let current = element
        while (current) {
            if (current !== document.body && current.nodeType === 1) {
                const style = window.getComputedStyle(current)
                const overflow = style.overflow + style.overflowY + style.overflowX
                if (/(auto|scroll)/.test(overflow)) {
                    if (current.scrollHeight > current.clientHeight ||
                        current.scrollWidth > current.clientWidth) {
                        return current
                    }
                }
            }
            if (current.parentElement) {
                current = current.parentElement
            } else if (current.parentNode && current.parentNode.host) {
                current = current.parentNode.host
            } else {
                break
            }
        }
        return window
    }

    container.onpointerdown = (e) => {
        const selection = doc.getSelection()
        const hasTextSelection = selection && selection.toString().length > 0

        const elementUnderCursor = doc.elementFromPoint(e.clientX, e.clientY)
        const hasTextUnderneath = elementUnderCursor &&
                             (elementUnderCursor.tagName === 'SPAN' || elementUnderCursor.tagName === 'P') &&
                             elementUnderCursor.textContent.trim().length > 0

        if (!hasTextUnderneath && !hasTextSelection) {
            pendingPan = true
            startX = e.screenX
            startY = e.screenY

            const iframe = doc.defaultView?.frameElement
            if (iframe) {
                scrollParent = findScrollableParent(iframe)
                if (scrollParent === window) {
                    scrollLeft = window.scrollX || window.pageXOffset
                    scrollTop = window.scrollY || window.pageYOffset
                } else {
                    scrollLeft = scrollParent.scrollLeft
                    scrollTop = scrollParent.scrollTop
                }
                container.style.cursor = 'grabbing'
            }
        } else {
            container.classList.add('selecting')
        }
    }

    container.onpointermove = (e) => {
        if (pendingPan && !isPanning) {
            const moved = Math.hypot(e.screenX - startX, e.screenY - startY)
            if (moved < PAN_THRESHOLD) return
            isPanning = true
            pendingPan = false
        }
        if (isPanning && scrollParent) {
            e.preventDefault()

            const dx = e.screenX - startX
            const dy = e.screenY - startY
            // Panning a zoomed page is a script write, not native scrolling, so
            // `touch-action` cannot constrain it. The renderer mirrors the
            // horizontal pan lock onto this document's root element (#5976);
            // read it back so a drag that is only slightly diagonal can't shift
            // the page sideways again.
            const lockX = doc.documentElement.style.touchAction === 'pan-y'

            if (scrollParent === window) {
                window.scrollTo(lockX ? window.scrollX : scrollLeft - dx, scrollTop - dy)
            } else {
                if (!lockX) scrollParent.scrollLeft = scrollLeft - dx
                scrollParent.scrollTop = scrollTop - dy
            }
        }
    }

    container.onpointerup = () => {
        pendingPan = false
        if (isPanning) {
            isPanning = false
            scrollParent = null
            container.style.cursor = 'grab'
        } else {
            container.classList.remove('selecting')
        }
    }

    container.onpointerleave = () => {
        pendingPan = false
        if (isPanning) {
            isPanning = false
            scrollParent = null
            container.style.cursor = 'grab'
        }
    }

    doc.addEventListener('selectionchange', () => {
        const selection = doc.getSelection()
        if (selection && selection.toString().length > 0) {
            container.style.cursor = 'text'
        } else if (!isPanning) {
            container.style.cursor = 'grab'
        }
    })

    container.style.cursor = 'grab'
}

// iOS kills the WKWebView content process when it exceeds a per-process memory
// high-water limit (~2 GB). A device crash log for readest #5118 shows the
// foreground WebContent process reaching 2.1 GB while paging a PDF, right before
// the reader "closed". Both a page's canvas bitmap and its WebKit backing layer
// are allocated at the render scale, so their memory grows with the SQUARE of the
// device pixel ratio. Phones report dpr 3, which is the tipping factor.
// Rendering at 2x instead of 3x is still retina-sharp but uses ~2.25x less memory
// per page (the crisp, selectable text layer is a separate DOM layer, unaffected).
const MAX_RENDER_DPR = 2
// Hard ceiling on a single page's bitmap area (~3.1 Mpx ≈ 12.6 MB) so a large
// tablet page can't blow the budget even after the dpr clamp.
const MAX_CANVAS_PIXELS = 2048 * 1536

// Only mobile WebViews get that budget. Desktop browsers have no per-process
// memory ceiling, and a page fitted to a desktop window is several times the
// budget on its own, so clamping there bought nothing and cost sharpness: the
// raster ended up coarser than the screen, the browser upscaled it into the CSS
// box, and PDF text looked blurry (readest #5251). iPadOS reports a desktop
// ("Macintosh") user agent, so touch points are what give a tablet away.
const isMobileWebView = () => {
    const ua = navigator.userAgent
    return /Android|iPhone|iPad|iPod/i.test(ua)
        || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
}

// The device pixel ratio to rasterise this page at: the real dpr on desktop, or
// on mobile the dpr clamped by both MAX_RENDER_DPR and the per-canvas pixel
// budget. Never below 1 (CSS resolution).
const getRenderDpr = (page, zoom) => {
    let dpr = devicePixelRatio || 1
    if (isMobileWebView()) {
        dpr = Math.min(dpr, MAX_RENDER_DPR)
        const { width, height } = page.getViewport({ scale: zoom || 1 })
        const area = width * height * dpr * dpr
        if (area > MAX_CANVAS_PIXELS) dpr *= Math.sqrt(MAX_CANVAS_PIXELS / area)
    }
    return Math.max(1, dpr)
}

// Render one PDF page into its iframe document: the page bitmap goes into
// `#canvas` and the selectable text layer into `.textLayer`, both laid out at the
// display scale (`zoom`) so text selection and annotation rectangles line up with
// the canvas at any zoom.
const render = async (page, doc, zoom) => {
    if (!doc) return

    // Rendering tears the text layer down and builds it again, which detaches
    // every Range held into it -- the sentence ranges TTS is reading from, and
    // anything anchored for selection or highlighting. fixed-layout re-renders
    // from a ResizeObserver on any layout change, including the one a page turn
    // itself causes, so the same page gets rendered twice per turn and the
    // second pass kills the ranges TTS just built (readest #6071). Skip the work
    // when nothing that affects the output has changed. The theme colours are
    // not part of the output: book.js paints them onto the finished bitmap from
    // CSS, so a theme change costs no re-render.
    const signature = [zoom, getFontScale(doc)].join('|')
    const rendered = renderedFor.get(doc)
    // Only trust the record when the page still has a bitmap. A superseded render
    // clears the canvas, and without this the guard would skip the work that puts
    // one back, leaving the page blank for good: a fast page turn or a resize
    // mid-render was enough to see a blank page from then on.
    const existingCanvas = doc.querySelector('#canvas > canvas')
    const hasBitmap = !!existingCanvas && existingCanvas.width > 0 && existingCanvas.height > 0
    if (rendered?.page === page && rendered.signature === signature && hasBitmap) return

    // Increment generation to invalidate any in-progress render for this doc
    const generation = (renderGenerations.get(doc) || 0) + 1
    renderGenerations.set(doc, generation)
    renderedFor.set(doc, { page, signature, generation })
    // Let a later render retry after this one bails without replacing the DOM.
    const forget = () => {
        if (renderedFor.get(doc)?.generation === generation) renderedFor.delete(doc)
    }

    // Cancel any in-progress render task for this document
    const existingTask = activeRenderTasks.get(doc)
    if (existingTask) {
        existingTask.cancel()
        activeRenderTasks.delete(doc)
    }

    // Rasterise the page bitmap over-sampled (clamped for the iOS content-process
    // memory budget, see getRenderDpr / readest #5118) but lay the whole DOM out
    // at the true display size. The <canvas> element natively downscales its
    // bitmap to its CSS box, so the raster stays crisp WITHOUT scaling the
    // document: scaling the document with `transform` promotes the whole page to
    // one over-sized GPU IOSurface that OOM-kills the iOS WebContent process on
    // zoom, and scaling it with `zoom` throws off getBoundingClientRect,
    // misplacing text selection and the annotation toolbar.
    const renderDpr = getRenderDpr(page, zoom)
    const renderScale = zoom * renderDpr
    doc.documentElement.style.setProperty('--total-scale-factor', zoom)
    doc.documentElement.style.setProperty('--scale-factor', zoom)
    doc.documentElement.style.setProperty('--user-unit', '1')
    doc.documentElement.style.setProperty('--scale-round-x', '1px')
    doc.documentElement.style.setProperty('--scale-round-y', '1px')
    const renderViewport = page.getViewport({ scale: renderScale })
    const displayViewport = page.getViewport({ scale: zoom })

    // the canvas must be in the `PDFDocument`'s `ownerDocument`
    // (`globalThis.document` by default); that's where the fonts are loaded
    const canvas = document.createElement('canvas')
    canvas.height = renderViewport.height
    canvas.width = renderViewport.width
    // The CSS box is the un-truncated display size, so the (integer-truncated)
    // over-sampled bitmap is scaled by the browser to fill the page box exactly.
    // Pinning the box to the display viewport (rather than letting the truncated
    // bitmap drive layout) also keeps the left page flush to the spine of a
    // two-page spread instead of exposing a one-pixel white seam (#4587).
    canvas.style.width = `${displayViewport.width}px`
    canvas.style.height = `${displayViewport.height}px`
    const canvasContext = canvas.getContext('2d')
    const renderTask = page.render({ canvasContext, viewport: renderViewport })
    activeRenderTasks.set(doc, renderTask)

    try {
        await renderTask.promise
    } catch {
        // Render was cancelled or failed -- release canvas bitmap memory
        canvas.width = 0
        canvas.height = 0
        forget()
        return
    } finally {
        if (activeRenderTasks.get(doc) === renderTask) {
            activeRenderTasks.delete(doc)
        }
    }

    // Bail out if a newer render has started or iframe was removed
    if (renderGenerations.get(doc) !== generation || !doc.defaultView) {
        canvas.width = 0
        canvas.height = 0
        forget()
        return
    }

    const canvasElement = doc.querySelector('#canvas')
    if (!canvasElement) {
        canvas.width = 0
        canvas.height = 0
        forget()
        return
    }

    // Release old canvas bitmap memory before replacing
    const oldCanvas = canvasElement.querySelector('canvas')
    if (oldCanvas) {
        oldCanvas.width = 0
        oldCanvas.height = 0
    }
    canvasElement.replaceChildren(doc.adoptNode(canvas))

    // Clear text layer before re-rendering to prevent DOM accumulation
    const container = doc.querySelector('.textLayer')
    container.replaceChildren()
    // pdf.js 3.x sizes glyphs and text boxes with `calc(var(--scale-factor) * Xpx)`
    // and refuses to lay out a text layer whose container does not declare the
    // factor, so publish the display scale before rendering it.
    container.style.setProperty('--scale-factor', zoom)
    await pdfjsLib.renderTextLayer({
        textContentSource: page.streamTextContent(),
        container, viewport: displayViewport,
    }).promise

    // Bail out if superseded after async text layer render
    if (renderGenerations.get(doc) !== generation) {
        forget()
        return
    }

    // Counteract the OS font-size accessibility scaling on the text layer's glyph
    // size only (see getFontScale): positions are percentages of the container and
    // scale with it, while the glyph size pdf.js writes is a `--scale-factor`
    // calc() the OS scaling inflates. Rewrite those to absolute px at the size
    // the canvas was rasterised with.
    const fontScale = getFontScale(doc)
    if (fontScale !== 1) {
        for (const span of container.querySelectorAll('span')) {
            const match = /calc\(var\(--scale-factor\)\s*\*\s*([\d.]+)px\)/.exec(span.style.fontSize)
            if (match) span.style.fontSize = `${parseFloat(match[1]) * zoom / fontScale}px`
        }
    }

    // fix text selection
    // https://github.com/mozilla/pdf.js/blob/642b9a5ae67ef642b9a8808fd9efd447e8c350e2/web/text_layer_builder.js#L105-L107
    const endOfContent = document.createElement('div')
    endOfContent.className = 'endOfContent'
    container.append(doc.adoptNode(endOfContent))

    // A scanned page has no text for pdf.js to lay out, and the rebuild above
    // cleared whatever OCR had put there, so the words are put back now — this
    // is the page's own renderer, and it runs on every zoom.
    restoreOcrWords(doc)

    // Set up panning/selection event handlers once per document
    setupPanningEvents(doc)

    // Clear annotation layer before re-rendering to prevent DOM accumulation
    const div = doc.querySelector('.annotationLayer')
    div.replaceChildren()
    const linkService = {
        goToDestination: () => {},
        getDestinationHash: dest => JSON.stringify(dest),
        // pdf.js AnnotationLayer calls getAnchorUrl for named-action / GoTo link
        // annotations; without it the render rejects with "getAnchorUrl is not a
        // function" (READEST-2M). Match pdf.js SimpleLinkService, which returns ''.
        getAnchorUrl: () => '',
        addLinkAttributes: (link, url) => link.href = url,
    }
    await new pdfjsLib.AnnotationLayer({ page, viewport: displayViewport, div }).render({
        annotations: await page.getAnnotations(),
        linkService,
    })
}

// A page's iframe document as `{ src, data, onZoom }`: `data` is the HTML the
// renderer loads as `srcdoc`, `src` a blob URL of the same document (the
// renderer requires it as a key), and `onZoom` is called by the renderer with
// the current scale so the page bitmap and text layer can be re-rendered crisply
// at that scale instead of being CSS-scaled.
const renderPage = async (page, getImageBlob) => {
    const viewport = page.getViewport({ scale: 1 })
    if (getImageBlob) {
        const canvas = document.createElement('canvas')
        canvas.height = viewport.height
        canvas.width = viewport.width
        const canvasContext = canvas.getContext('2d')
        await page.render({ canvasContext, viewport }).promise
        return new Promise(resolve => canvas.toBlob(blob => {
            // Release canvas bitmap memory after extracting the blob
            canvas.width = 0
            canvas.height = 0
            resolve(blob)
        }))
    }
    const data = `
        <!DOCTYPE html>
        <html lang="en">
        <meta charset="utf-8">
        <meta name="viewport" content="width=${viewport.width}, height=${viewport.height}">
        <style>
        html, body {
            margin: 0;
            padding: 0;
            background-color: transparent;
        }
        ${textLayerBuilderCSS}
        ${annotationLayerBuilderCSS}
        </style>
        <div id="canvas"></div>
        <div class="textLayer"></div>
        <div class="annotationLayer"></div>
    `
    const src = URL.createObjectURL(new Blob([data], { type: 'text/html' }))
    const onZoom = ({ doc, scale }) => render(page, doc, scale)
    return { src, data, onZoom }
}

const makeTOCItem = async (item, pdf) => {
    let pageIndex = undefined

    if (item.dest) {
        try {
            const dest = typeof item.dest === 'string'
                ? await pdf.getDestination(item.dest)
                : item.dest
            if (dest?.[0]) {
                pageIndex = await pdf.getPageIndex(dest[0])
            }
        } catch (e) {
            console.warn('Failed to get page index for TOC item:', item.title, e)
        }
    }

    return {
        label: item.title,
        href: item.dest ? JSON.stringify(item.dest) : '',
        index: pageIndex,
        subitems: item.items?.length
            ? await Promise.all(item.items.map(i => makeTOCItem(i, pdf)))
            : null,
    }
}

// Cache of decoded pdf.js page objects and their rendered HTML documents. These
// are cheap (page metadata + a small blob URL, not the large canvas bitmap, which
// lives in the visible iframe) so this can comfortably exceed the live-canvas
// cap in fixed-layout's scroll mode, sparing a re-parse when the reader scrolls
// back over a recently seen page.
const MAX_CACHED_PAGES = 16

// Maximum number of range reads to keep in flight at once. While parsing a
// large PDF's cross-reference and object streams, pdf.js can request hundreds
// of byte ranges in a single burst. A real HTTP transport is implicitly
// throttled by the browser's per-host connection limit (~6); the custom file
// schemes readest serves these reads through (Android's `rangefile` /
// `shouldInterceptRequest`, iOS' native file bridge) have no such limit, so
// firing every request at once floods the native handler and exhausts the
// WebView's heap, crashing on 50 MB+ PDFs (readest #3470). Throttle here.
const MAX_CONCURRENT_RANGES = 6

// Serve a pdf.js range transport from a File, bounding the concurrent reads
// instead of dispatching them all at once (see MAX_CONCURRENT_RANGES).
export const connectRangeTransport = (file, transport) => {
    let active = 0
    const queue = []
    const pump = () => {
        while (active < MAX_CONCURRENT_RANGES && queue.length) {
            const [begin, end] = queue.shift()
            active++
            file.slice(begin, end).arrayBuffer()
                .then(chunk => transport.onDataRange(begin, chunk))
                .finally(() => { active--; pump() })
        }
    }
    transport.requestDataRange = (begin, end) => {
        queue.push([begin, end])
        pump()
    }
}

export const makePDF = async file => {
    // Stream the file through a range transport instead of reading it whole:
    // a large PDF would otherwise be materialised in the WebView heap before the
    // first page is even parsed.
    const transport = new pdfjsLib.PDFDataRangeTransport(file.size, [])
    connectRangeTransport(file, transport)
    const loadingTask = pdfjsLib.getDocument({
        range: transport,
        cMapUrl: pdfjsVendorPath('cmaps/'),
        cMapPacked: true,
        standardFontDataUrl: pdfjsVendorPath('standard_fonts/'),
        isEvalSupported: false,
    })
    const pdf = await loadingTask.promise

    // Get viewport dimensions from the first page for fixed-layout rendering
    const firstPage = await pdf.getPage(1)
    const firstViewport = firstPage.getViewport({ scale: 1 })
    const book = { rendition: {
        layout: 'pre-paginated',
        viewport: { width: firstViewport.width, height: firstViewport.height },
    } }

    const { metadata, info } = await pdf.getMetadata() ?? {}
    book.metadata = parsePDFMetadata({ info, xmp: metadata?.getRaw?.() })

    // PDFs bound right-to-left (Japanese photo books, manga) declare it in the
    // catalog's ViewerPreferences; surface it as book.dir so the fixed-layout
    // renderer pairs and orders two-page spreads right-to-left.
    const viewerPreferences = await pdf.getViewerPreferences().catch(() => null)
    const direction = viewerPreferences?.get?.('Direction')
        ?? viewerPreferences?.Direction
    if (direction === 'R2L') book.dir = 'rtl'

    const outline = await pdf.getOutline()
    book.toc = outline ? await Promise.all(outline.map(item => makeTOCItem(item, pdf))) : null

    // Page labels (PDF 32000-1 §12.4.2) are the numbers printed on the pages
    // -- roman-numeral front matter, a body that restarts at 1 -- and are what
    // the book's own TOC means by "page 139", as opposed to the physical index
    // into the file. Expose them as the page list so they reach readers through
    // the same `pageItem` channel as an EPUB page-list nav. Like PDF.js, ignore
    // labels that merely restate the physical page numbers or are all empty.
    const labels = await pdf.getPageLabels().catch(() => null)
    book.pageList = labels?.some((label, i) => label && label !== String(i + 1))
        ? labels.map((label, i) => ({ label, href: JSON.stringify(i), index: i }))
        : null

    const cache = new Map()
    const pageCache = new Map()
    const getPage = async (i) => {
        const cached = pageCache.get(i)
        if (cached) {
            // Move to end for LRU ordering
            pageCache.delete(i)
            pageCache.set(i, cached)
            return cached
        }
        const page = await pdf.getPage(i + 1)
        pageCache.set(i, page)

        // Evict oldest pages when over limit, freeing internal page data
        while (pageCache.size > MAX_CACHED_PAGES) {
            const oldestKey = pageCache.keys().next().value
            const oldPage = pageCache.get(oldestKey)
            pageCache.delete(oldestKey)
            oldPage?.cleanup()
        }

        return page
    }
    book.sections = Array.from({ length: pdf.numPages }).map((_, i) => ({
        id: i,
        load: async () => {
            const cached = cache.get(i)
            if (cached) {
                // Move to end for LRU ordering
                cache.delete(i)
                cache.set(i, cached)
                return cached
            }
            const url = await renderPage(await getPage(i))
            cache.set(i, url)

            // Evict oldest render results when over limit
            while (cache.size > MAX_CACHED_PAGES) {
                const oldestKey = cache.keys().next().value
                const oldEntry = cache.get(oldestKey)
                cache.delete(oldestKey)
                if (oldEntry?.src) URL.revokeObjectURL(oldEntry.src)
            }

            return url
        },
        // A standalone document for this page, with the same text layer the
        // reader sees. In-book search and TTS walk this document instead of the
        // live iframe so they work without the page being on screen.
        createDocument: async () => {
            const page = await getPage(i)
            const doc = document.implementation.createHTMLDocument('')

            const canvas = doc.createElement('div')
            canvas.id = 'canvas'
            doc.body.appendChild(canvas)

            const textLayer = doc.createElement('div')
            textLayer.className = 'textLayer'
            doc.body.appendChild(textLayer)

            const annotationLayer = doc.createElement('div')
            annotationLayer.className = 'annotationLayer'
            doc.body.appendChild(annotationLayer)

            // TextLayer requires a canvas 2d context for font metrics; fall back
            // to manual span construction when unavailable.
            const probe = doc.createElement('canvas')
            if (probe.getContext?.('2d')) {
                textLayer.style.setProperty('--scale-factor', 1)
                await pdfjsLib.renderTextLayer({
                    textContentSource: page.streamTextContent(),
                    container: textLayer, viewport: page.getViewport({ scale: 1 }),
                }).promise
            } else {
                const content = await page.getTextContent()
                for (const item of content.items) {
                    if (item.str) {
                        const span = doc.createElement('span')
                        span.textContent = item.str
                        textLayer.appendChild(span)
                    }
                }
            }
            return doc
        },
        size: 1000,
    }))
    // The first page of a PDF is its cover: keep it alone instead of pairing it
    // with page two in a spread.
    if (book.sections.length) book.sections[0].pageSpread = 'right'
    book.isExternal = uri => /^\w+:/i.test(uri)
    // TOC hrefs are JSON-encoded destinations (named or explicit); page-list
    // hrefs are JSON-encoded page indices.
    book.resolveHref = async href => {
        if (href == null || href === '') return { index: 0 }
        let parsed
        try {
            parsed = JSON.parse(href)
        } catch {
            return { index: 0 }
        }
        if (typeof parsed === 'number') return { index: parsed }
        const dest = typeof parsed === 'string'
            ? await pdf.getDestination(parsed) : parsed
        if (!dest?.[0]) return { index: 0 }
        const index = await pdf.getPageIndex(dest[0])
        return { index }
    }
    book.splitTOCHref = async href => {
        if (!href) return [null, null]
        let parsed
        try {
            parsed = JSON.parse(href)
        } catch {
            return [null, null]
        }
        if (typeof parsed === 'number') return [parsed, null]
        const dest = typeof parsed === 'string'
            ? await pdf.getDestination(parsed) : parsed
        try {
            const index = await pdf.getPageIndex(dest[0])
            return [index, null]
        } catch (e) {
            console.warn('Error getting page index for href', href, e)
            return [null, null]
        }
    }
    book.getTOCFragment = doc => doc.documentElement
    book.getCover = async () => renderPage(await pdf.getPage(1), true)
    book.destroy = () => {
        // Clean up all cached canvases and revoke blob URLs
        for (const [, entry] of cache) {
            if (entry?.src) URL.revokeObjectURL(entry.src)
        }
        cache.clear()
        for (const [, page] of pageCache) {
            page?.cleanup()
        }
        pageCache.clear()
        loadingTask.destroy()
    }
    return book
}
