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
 */
export const nearestOcrWord = (words, nx, ny) => {
    let best = null
    let bestScore = Infinity
    for (const word of words) {
        const dx = Math.max(word.x - nx, 0, nx - (word.x + word.w))
        const dy = Math.max(word.y - ny, 0, ny - (word.y + word.h))
        // Stay on the line whose leading the press is in (0.75 of a line either
        // way), and within a fifth of a word's width sideways.
        if (dy > word.h * 0.75) continue
        if (dx > Math.max(word.w * 0.5, 0.01)) continue
        const score = dy * 2 + dx
        if (score < bestScore) {
            bestScore = score
            best = word
        }
    }
    return best
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
