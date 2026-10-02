/**
 * The text OCR finds on pages that carry none of their own (scanned PDFs).
 *
 * A scanned page is a bitmap with nothing to select, so a press asks the app to
 * read the page and the words come back as that page's text layer. From there
 * the reader's ordinary paths apply: a word can be selected, the context menu
 * opens over it, highlights and narration work as on a text page.
 *
 * The words are kept here for the session, and handed to the app (which keeps
 * them next to the book) so the page still has its text when the book is opened
 * again — a highlight made on a recognised word needs something to anchor to in
 * the next session. Both live in this module because the page's renderer (which
 * is what clears the text layer) has to be able to put the words back.
 *
 * The only thing this module does not own is the gesture: `book.js` decides
 * when a press is a long press and calls in.
 */

/** How long a press has to be held, and how far it may drift, to mean "read this page". */
export const OCR_HOLD_MS = 450
export const OCR_DRIFT_PX = 14

/** Normalised words per section index: `{ text, x, y, w, h }`, 0..1 of the page. */
export const ocrWordsByPage = new Map()

/** Pages the app has no words for, so they are not asked about twice. */
export const pagesWithoutWords = new Set()

export const pageTextLayer = doc => doc?.querySelector('.textLayer') ?? null

/** The page has text of its own (a PDF with a text layer), so it needs no OCR. */
export const pageHasOwnText = (doc) => {
    const layer = pageTextLayer(doc)
    if (!layer?.textContent?.trim()) return false
    return !layer.querySelector('span[data-ocr-word]')
}

/** The page carries the words OCR put there. */
export const pageHasOcrText = (doc) =>
    !!pageTextLayer(doc)?.querySelector('span[data-ocr-word]')

export const sectionIndexOfDoc = (doc) => {
    const raw = doc?.defaultView?.frameElement?.dataset?.sectionIndex
    return raw != null && raw !== '' ? parseInt(raw) : null
}

/** Place normalised [words] into the page's text layer. */
export const injectOcrTextLayer = (doc, words) => {
    const layer = pageTextLayer(doc)
    const canvas = doc.querySelector('#canvas > canvas')
    if (!layer || !canvas) return false
    // The normalised boxes are placed against the canvas's own CSS box, which is
    // the same space the text layer covers at any zoom.
    const width = canvas.clientWidth || canvas.width
    const height = canvas.clientHeight || canvas.height
    if (!width || !height) return false
    layer.replaceChildren()
    words.forEach((word, i) => {
        const span = doc.createElement('span')
        span.textContent = word.text
        span.dataset.ocrWord = String(i)
        const w = word.w * width
        const h = word.h * height
        Object.assign(span.style, {
            position: 'absolute',
            left: `${word.x * width}px`,
            top: `${word.y * height}px`,
            width: `${w}px`,
            height: `${h}px`,
            fontSize: `${Math.max(h, 1)}px`,
            lineHeight: `${h}px`,
            whiteSpace: 'pre',
            color: 'transparent',
            transformOrigin: '0 0',
        })
        layer.append(span)
    })
    return layer.childElementCount > 0
}

/**
 * The word a press at `(nx, ny)` — a fraction of the page — means, when the
 * point is not inside any word's box. A press lands in the gap between two
 * words, or in the leading above a line, often enough that picking the nearest
 * word on that line is what the reader expects; a press nowhere near a line
 * picks nothing at all.
 *
 * The distances are measured in a typical line's height, not in the page's own
 * fractions and not in the candidate's size. A page of this kind carries
 * display text and lettering read out of an illustration alongside body text,
 * and those words are several times the height of a body word: a tolerance
 * scaled to them would reach across the line below and answer a press on body
 * text with a word out of the drawing above it.
 */
export const nearestOcrWord = (words, nx, ny) => {
    if (!words?.length) return null
    const heights = words.map(word => word.h).filter(h => h > 0)
        .sort((a, b) => a - b)
    if (!heights.length) return null
    const unit = heights[heights.length >> 1]
    let best = null
    let bestScore = Infinity
    for (const word of words) {
        const dx = Math.max(word.x - nx, 0, nx - (word.x + word.w)) / unit
        const dy = Math.max(word.y - ny, 0, ny - (word.y + word.h)) / unit
        // Stay on the press's own line: a word a line away is another line,
        // however close its box happens to come.
        if (dy > 0.75) continue
        // A few word-widths along the line, in the same unit.
        if (dx > 4) continue
        const score = dy * 4 + dx
        if (score < bestScore) {
            bestScore = score
            best = word
        }
    }
    return best
}

/** The word spans of a recognised page, in the order they were injected. */
const ocrWordSpans = doc =>
    Array.from(pageTextLayer(doc)?.querySelectorAll('span[data-ocr-word]') ?? [])

/** The word a node belongs to, whether the node is its text or the span itself. */
const spanOf = node => {
    const el = node?.nodeType === 1 ? node : node?.parentElement
    return el?.closest?.('span[data-ocr-word]') ?? null
}

/**
 * The word a touch at `(x, y)` — the page's own client coordinates — means, as
 * an index into the page's words. The element the touch landed on answers it
 * outright when the page's words are already there; otherwise the point is
 * tested against the boxes and then against `nearestOcrWord`.
 */
export const wordIndexAt = (doc, x, y, target = null) => {
    const words = ocrWordsByPage.get(sectionIndexOfDoc(doc)) ?? []
    const spans = ocrWordSpans(doc)
    if (!words.length || !spans.length) return -1
    const touched = target?.closest?.('span[data-ocr-word]')
    if (touched && doc.contains(touched)) {
        const index = Number(touched.dataset.ocrWord)
        if (Number.isInteger(index) && index >= 0 && index < spans.length) return index
    }
    const canvas = doc.querySelector('#canvas > canvas')
    const box = canvas?.getBoundingClientRect()
    if (!box?.width || !box?.height) return -1
    const nx = (x - box.left) / box.width
    const ny = (y - box.top) / box.height
    const inside = words.find(word =>
        nx >= word.x && nx <= word.x + word.w && ny >= word.y && ny <= word.y + word.h)
        ?? nearestOcrWord(words, nx, ny)
    return inside ? words.indexOf(inside) : -1
}

/** The radius of a handle's grab, and the size of the dot that shows where it is. */
const HANDLE_SIZE = 13
const HANDLE_REACH = 24

const handleStyle = () => ({
    position: 'absolute',
    width: `${HANDLE_SIZE}px`,
    height: `${HANDLE_SIZE}px`,
    marginLeft: `${-HANDLE_SIZE / 2}px`,
    marginTop: `${-HANDLE_SIZE / 2}px`,
    borderRadius: '50%',
    background: '#1a73e8',
    boxShadow: '0 0 0 2px #ffffff',
    pointerEvents: 'none',
})

const handleLayerOf = doc => pageTextLayer(doc)?.querySelector('.anx-handles') ?? null

export const hideOcrSelectionHandles = doc => {
    handleLayerOf(doc)?.remove()
}

/**
 * Show where the two ends of a recognised page's selection are, so a finger can
 * take hold of them: the WebView draws the selection itself but no handles —
 * a selection made in script gets no grips to drag.
 */
export const showOcrSelectionHandles = doc => {
    const layer = pageTextLayer(doc)
    const selection = doc?.defaultView?.getSelection?.()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    if (!layer || !range || range.collapsed) return hideOcrSelectionHandles(doc)
    const rects = Array.from(range.getClientRects()).filter(r => r.width || r.height)
    if (!rects.length) return hideOcrSelectionHandles(doc)
    let box = handleLayerOf(doc)
    if (!box) {
        box = doc.createElement('div')
        box.className = 'anx-handles'
        Object.assign(box.style, {
            position: 'absolute',
            inset: '0',
            pointerEvents: 'none',
            zIndex: '3',
        })
        layer.append(box)
    }
    const base = layer.getBoundingClientRect()
    const first = rects[0]
    const last = rects[rects.length - 1]
    const place = (side, x, y) => {
        let handle = box.querySelector(`.anx-handle[data-anx-handle="${side}"]`)
        if (!handle) {
            handle = doc.createElement('div')
            handle.className = 'anx-handle'
            Object.assign(handle.style, handleStyle())
            box.append(handle)
        }
        handle.dataset.anxHandle = side
        handle.style.left = `${x - base.left}px`
        handle.style.top = `${y - base.top}px`
    }
    place('start', first.left, first.top + first.height / 2)
    place('end', last.right, last.top + last.height / 2)
    return true
}

/**
 * Which handle, if any, a touch at `(x, y)` is on: `'start'`, `'end'`, or
 * nothing. The nearest one wins: the two grips of a short word sit a couple of
 * dozen pixels apart, closer than either of them reaches.
 */
export const ocrHandleAt = (doc, x, y) => {
    let best = null
    let bestDistance = Infinity
    for (const handle of handleLayerOf(doc)?.querySelectorAll('.anx-handle') ?? []) {
        const rect = handle.getBoundingClientRect()
        const dx = x - (rect.left + rect.width / 2)
        const dy = y - (rect.top + rect.height / 2)
        if (Math.abs(dx) > HANDLE_REACH || Math.abs(dy) > HANDLE_REACH) continue
        const distance = Math.abs(dx) + Math.abs(dy)
        if (distance < bestDistance) {
            bestDistance = distance
            best = handle.dataset.anxHandle
        }
    }
    return best
}

/**
 * The end of the selection that a drag of [side] leaves alone: the other edge,
 * as the text node and offset it sits at. Taken when the finger goes down,
 * because the page's own selection is free to collapse under a moving finger
 * and the anchor is what the range is rebuilt from every time.
 */
export const ocrHandleAnchor = (doc, side) => {
    const selection = doc?.defaultView?.getSelection?.()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    if (!range || range.collapsed) return null
    const node = side === 'end' ? range.startContainer : range.endContainer
    const offset = side === 'end' ? range.startOffset : range.endOffset
    const span = spanOf(node)
    if (!span) return null
    return { index: Number(span.dataset.ocrWord), node, offset }
}

/**
 * Move the handle being dragged to the word under the finger, so the selection
 * grows or shrinks a word at a time. The whole range is rewritten from
 * [anchor] on every move rather than one end nudged, so a selection the page
 * collapses under the finger is put back on the next move instead of lost.
 *
 * A handle never reaches past the other one: dragged towards it, the selection
 * stops at the word the anchor is in.
 */
export const dragOcrSelectionHandle = (doc, side, x, y, anchor) => {
    const spans = ocrWordSpans(doc)
    const index = wordIndexAt(doc, x, y)
    if (!(index >= 0) || !spans[index] || !anchor) return false
    const text = spans[index].firstChild
    if (!text) return false
    const selection = doc?.defaultView?.getSelection?.()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    if (!range) return false
    const forward = side === 'end' ? index >= anchor.index : index <= anchor.index
    if (!forward) return false
    if (side === 'end') {
        range.setStart(anchor.node, anchor.offset)
        range.setEnd(text, text.data.length)
    } else {
        range.setEnd(anchor.node, anchor.offset)
        range.setStart(text, 0)
    }
    if (range.collapsed) return false
    showOcrSelectionHandles(doc)
    return true
}

/**
 * Put a page's words back: from memory, or from the app (which keeps them per
 * book and page). Answers whether the page ended up with text, and tells the
 * page's own document about it, so the reader can draw what was waiting on it.
 */
export const restoreOcrWords = async (doc, index = sectionIndexOfDoc(doc)) => {
    if (!doc || index == null) return false
    if (pageHasOcrText(doc)) return false      // already put back
    if (pageHasOwnText(doc)) return false      // not a scanned page
    let words = ocrWordsByPage.get(index)
    if (!words) {
        if (pagesWithoutWords.has(index)) return false
        try {
            const answer = await window.flutter_inappwebview.callHandler('ocrCached', { page: index })
            words = Array.isArray(answer?.words) ? answer.words : null
        } catch (e) {
            return false
        }
        if (!words?.length) {
            pagesWithoutWords.add(index)
            return false
        }
        ocrWordsByPage.set(index, words)
    }
    const injected = injectOcrTextLayer(doc, words)
    if (injected) {
        doc.dispatchEvent(new CustomEvent('anx-ocr-restored'))
    }
    return injected
}

/**
 * Ask the app to read [index]. ML Kit answers in bitmap pixels; the page needs
 * them as a fraction of the page, which is what survives a re-render at another
 * zoom, and what the app is given to keep.
 */
export const ocrPage = async (index, { canvas, language }) => {
    if (ocrWordsByPage.has(index)) return ocrWordsByPage.get(index)
    let answer
    try {
        answer = await window.flutter_inappwebview.callHandler('ocrPage', {
            image: canvas.toDataURL('image/png'),
            page: index,
            language: language ?? '',
        })
    } catch (e) {
        console.warn('OCR request failed', e)
        return null
    }
    if (!answer?.ok || !answer.words?.length) {
        window.flutter_inappwebview.callHandler('ocrUnavailable',
            { page: index, reason: answer?.reason ?? '' })
        return null
    }
    const words = answer.words.map(w => ({
        text: String(w.text ?? ''),
        x: w.x / canvas.width,
        y: w.y / canvas.height,
        w: w.w / canvas.width,
        h: w.h / canvas.height,
    })).filter(w => w.text)
    if (!words.length) return null
    ocrWordsByPage.set(index, words)
    pagesWithoutWords.delete(index)
    window.flutter_inappwebview.callHandler('ocrSave', { page: index, words })
    return words
}
