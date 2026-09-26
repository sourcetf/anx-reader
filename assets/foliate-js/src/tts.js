const blockTags = new Set([
    'article', 'aside', 'audio', 'blockquote', 'caption',
    'details', 'dialog', 'div', 'dl', 'dt', 'dd',
    'figure', 'footer', 'form', 'figcaption',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hgroup', 'hr', 'li',
    'main', 'math', 'nav', 'ol', 'p', 'pre', 'section', 'tr',
])

function rangeIsEmpty(range) {
    return range.collapsed || range.toString().trim() === ''
}

const quoteChars = new Set(['"', "'", '“', '”', '‘', '’'])

const isLocalLink = href => {
    if (!href) return false
    const trimmed = href.trim()
    if (!trimmed) return false
    if (trimmed.startsWith('#')) return true
    return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)
}

const shouldSkipTextNode = node => {
    const parent = node.parentElement
    if (!parent) return false
    const anchor = parent.closest('a')
    if (!anchor) return false
    return isLocalLink(anchor.getAttribute('href'))
}

const getRangeText = (range, nodeFilter) => {
    const fragment = range.cloneContents()
    const walker = document.createTreeWalker(fragment,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
    let text = ''
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (node.nodeType === Node.ELEMENT_NODE) {
            // pdf.js emits a <br> for every text-layer line break; without a
            // separator the words on either side of it would be joined
            if (node.tagName?.toLowerCase() === 'br') text += ' '
            continue
        }
        if (shouldSkipTextNode(node)) continue
        if (nodeFilter?.(node) === NodeFilter.FILTER_REJECT) continue
        text += node.textContent ?? ''
    }
    return text
}

const findBlockAncestor = node => {
    let el = node.parentElement
    while (el && !blockTags.has(el.tagName?.toLowerCase?.())) {
        el = el.parentElement
    }
    return el ?? node.ownerDocument?.body ?? null
}

const isSentenceTerminator = (char, nextChar) => {
    if (char === '.') {
        if (!nextChar) return true
        if (quoteChars.has(nextChar)) return true
        if (/\s/.test(nextChar)) return true
        return false
    }
    return char === '!' || char === '?' || char === '。' || char === '！' || char === '？'
}

const advancePastQuotes = (text, index) => {
    let end = index
    while (end < text.length && quoteChars.has(text[end])) end++
    return end
}

const NS = { XML: 'http://www.w3.org/XML/1998/namespace', SSML: 'http://www.w3.org/2001/10/synthesis' }

const getLang = el => {
    const x = el.lang || el?.getAttributeNS?.(NS.XML, 'lang')
    return x ? x : el.parentElement ? getLang(el.parentElement) : null
}

// For PDF text layers, split content into sentence-level blocks so TTS
// reads one sentence at a time instead of the whole page in one block.
// Text nodes are split at sentence boundaries so that every block range
// aligns with node edges — this prevents the text walker from including
// text outside the sentence in word marks.
function* getPDFSentenceBlocks(doc, textLayer) {
    const collectNodes = () => {
        const w = doc.createTreeWalker(textLayer, NodeFilter.SHOW_TEXT)
        const res = []
        for (let n = w.nextNode(); n; n = w.nextNode()) res.push(n)
        return res
    }

    let nodes = collectNodes()
    if (!nodes.length) return

    const fullText = nodes.map(n => n.nodeValue).join('')
    if (!fullText.trim()) return

    // Find sentence boundary positions
    const lang = getLang(textLayer) || undefined
    const segmenter = new Intl.Segmenter(lang, { granularity: 'sentence' })
    const boundaries = new Set()
    for (const { index } of segmenter.segment(fullText))
        if (index > 0) boundaries.add(index)

    // Split text nodes at sentence boundaries so ranges align with node edges.
    // Process in reverse order to preserve earlier character positions.
    let cum = 0
    const nodeStarts = nodes.map(n => { const s = cum; cum += n.nodeValue.length; return s })

    for (const pos of [...boundaries].sort((a, b) => b - a)) {
        for (let i = 0; i < nodes.length; i++) {
            const start = nodeStarts[i]
            const end = start + nodes[i].nodeValue.length
            if (pos > start && pos < end) {
                nodes[i].splitText(pos - start)
                break
            }
        }
    }

    // Re-collect nodes after splits and group into sentence blocks
    nodes = collectNodes()
    cum = 0
    let groupStart = 0
    let blockCount = 0

    for (let i = 0; i < nodes.length; i++) {
        cum += nodes[i].nodeValue.length
        const isEnd = i === nodes.length - 1 || boundaries.has(cum)
        if (isEnd) {
            const range = doc.createRange()
            range.setStart(nodes[groupStart], 0)
            range.setEnd(nodes[i], nodes[i].nodeValue.length)
            if (!rangeIsEmpty(range)) {
                blockCount++
                yield range
            }
            groupStart = i + 1
        }
    }
}

function* getBlocks(doc, nodeFilter) {
    const root = doc.body ?? doc.querySelector('body') ?? doc.documentElement
    // For PDF text layers, yield sentence-level blocks (never annotationLayer text)
    const textLayer = root.querySelector?.('.textLayer')
    if (textLayer) {
        yield* getPDFSentenceBlocks(doc, textLayer)
        return
    }
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    let startNode = null
    let startOffset = 0
    let currentBlock = null
    let lastNode = null
    let lastOffset = 0

    const flushRange = () => {
        if (!startNode || !lastNode) return null
        const range = doc.createRange()
        range.setStart(startNode, startOffset)
        range.setEnd(lastNode, lastOffset)
        startNode = null
        startOffset = 0
        currentBlock = null
        lastNode = null
        lastOffset = 0
        if (rangeIsEmpty(range)) return null
        return range
    }

    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent) continue
        if (shouldSkipTextNode(node)) continue

        const block = findBlockAncestor(node)

        // A block the caller's filter rejects (an annotationLayer, a footnote
        // aside) must not be read: drop its text nodes so the range of the
        // surrounding blocks ends before it instead of swallowing it
        if (nodeFilter?.(block) === NodeFilter.FILTER_REJECT) continue

        if (!startNode) {
            startNode = node
            startOffset = 0
            currentBlock = block
        } else if (block !== currentBlock) {
            const range = flushRange()
            if (range) yield range
            startNode = node
            startOffset = 0
            currentBlock = block
        }

        const text = node.textContent
        let index = 0
        while (index < text.length) {
            const char = text[index]
            const nextChar = text[index + 1]
            if (isSentenceTerminator(char, nextChar)) {
                const endOffset = advancePastQuotes(text, index + 1)
                const range = doc.createRange()
                range.setStart(startNode, startOffset)
                range.setEnd(node, endOffset)
                if (!rangeIsEmpty(range)) yield range
                startNode = node
                startOffset = endOffset
                lastNode = node
                lastOffset = endOffset
                index = endOffset
                continue
            }
            index += 1
        }

        lastNode = node
        lastOffset = text.length

        if (startNode === node && startOffset === text.length) {
            startNode = null
            startOffset = 0
            currentBlock = null
        }
    }

    const remaining = flushRange()
    if (remaining) yield remaining
}

// Enumerate every TTS segment of the document in order without touching any
// TTS instance state. blockIndex/markName match what a TTS instance produces
// for the same granularity, so callers (e.g. a playback timeline) can
// correlate the enumeration with live marks and use each range with from().
export function* getSentences(doc, nodeFilter) {
    let blockIndex = 0
    for (const range of getBlocks(doc, nodeFilter)) {
        yield { blockIndex, markName: String(blockIndex), range }
        blockIndex++
    }
}

class ListIterator {
    #arr = []
    #iter
    #index = -1
    #f
    constructor(iter, f = x => x) {
        this.#iter = iter
        this.#f = f
    }
    current() {
        if (this.#arr[this.#index]) return this.#f(this.#arr[this.#index])
    }
    first() {
        const newIndex = 0
        if (this.#arr[newIndex]) {
            this.#index = newIndex
            return this.#f(this.#arr[newIndex])
        }
    }
    last() {
        for (const value of this.#iter) this.#arr.push(value)
        const newIndex = this.#arr.length - 1
        if (this.#arr[newIndex]) {
            this.#index = newIndex
            return this.#f(this.#arr[newIndex])
        }
    }
    prev() {
        const newIndex = this.#index - 1
        if (this.#arr[newIndex]) {
            this.#index = newIndex
            return this.#f(this.#arr[newIndex])
        }
    }
    next() {
        const newIndex = this.#index + 1
        if (this.#arr[newIndex]) {
            this.#index = newIndex
            return this.#f(this.#arr[newIndex])
        }
        while (true) {
            const { done, value } = this.#iter.next()
            if (done) break
            this.#arr.push(value)
            if (this.#arr[newIndex]) {
                this.#index = newIndex
                return this.#f(this.#arr[newIndex])
            }
        }
    }
    #ensure(index) {
        while (this.#arr[index] == null) {
            const { done, value } = this.#iter.next()
            if (done) break
            this.#arr.push(value)
            if (this.#arr.length - 1 >= index) break
        }
        return this.#arr[index]
    }
    prepare() {
        const newIndex = this.#index + 1
        if (this.#arr[newIndex]) return this.#f(this.#arr[newIndex])
        while (true) {
            const { done, value } = this.#iter.next()
            if (done) break
            this.#arr.push(value)
            if (this.#arr[newIndex]) return this.#f(this.#arr[newIndex])
        }
    }
    peek(count = 1, offset = 1) {
        if (count <= 0) return []
        const startIndex = Math.max(this.#index + offset, 0)
        const results = []
        const endIndex = startIndex + count
        for (let idx = startIndex; idx < endIndex; idx++) {
            const value = this.#arr[idx] ?? this.#ensure(idx)
            if (!value) break
            results.push(this.#f(value))
        }
        return results
    }
    find(f) {
        const index = this.#arr.findIndex(x => f(x))
        if (index > -1) {
            this.#index = index
            return this.#f(this.#arr[index])
        }
        while (true) {
            const { done, value } = this.#iter.next()
            if (done) break
            this.#arr.push(value)
            if (f(value)) {
                this.#index = this.#arr.length - 1
                return this.#f(value)
            }
        }
    }
}

export class TTS {
    #list
    #ranges = new Map()
    #lastMark
    #getCfi
    constructor(doc, textWalker, nodeFilter, highlight, granularity, getCfi) {
        this.doc = doc
        this.highlight = highlight
        this.#getCfi = getCfi
        // ANX builds its segments out of `getBlocks`, which already splits at
        // sentence boundaries, so `granularity` is only accepted for signature
        // compatibility with readest's TTS.
        let mark = 0
        this.#list = new ListIterator(getBlocks(doc, nodeFilter), range => {
            const name = String(mark++)
            this.#ranges.set(name, range)
            return [getRangeText(range, nodeFilter), range, name]
        })
    }

    #getText(text, getNode) {
        if (!text) return ''
        if (!getNode) return text
        const tempElement = document.createElement('div')
        tempElement.innerHTML = text
        let node = getNode(tempElement)?.previousSibling
        while (node) {
            const next = node.previousSibling ?? node.parentNode?.previousSibling
            node.parentNode.removeChild(node)
            node = next
        }
        return tempElement.textContent
    }

    #ensureCurrentEntry() {
        const current = this.#list.current()
        if (current) return current
        return this.#list.first() ?? this.#list.next()
    }

    #resultFrom(entry, { highlight = false } = {}) {
        if (!entry) return null
        const [text, range, mark] = entry
        if (!text || !range) return null
        if (mark) this.#lastMark = mark
        const plainText = this.#getText(text)
        let cfi = null
        if (highlight && this.highlight && range.cloneRange) {
            cfi = this.highlight(range.cloneRange()) ?? null
        }
        if (!cfi && this.#getCfi && range.cloneRange) {
            cfi = this.#getCfi(range.cloneRange())
        }
        return { text: plainText, cfi }
    }

    start() {
        this.#lastMark = null
        const entry = this.#list.first()
        if (!entry) return this.next()
        return this.#resultFrom(entry, { highlight: true })?.text
    }

    end() {
        this.#lastMark = null
        const entry = this.#list.last()
        if (!entry) return this.next()
        return this.#resultFrom(entry, { highlight: true })?.text
    }

    resume() {
        const entry = this.#list.current()
        if (!entry) return this.next()
        return this.#resultFrom(entry)?.text
    }

    prev(paused) {
        this.#lastMark = null
        const entry = this.#list.prev()
        if (paused && entry?.[1]) this.highlight(entry[1].cloneRange())
        return this.#resultFrom(entry)?.text
    }

    next(paused) {
        this.#lastMark = null
        const entry = this.#list.next()
        if (paused && entry?.[1]) this.highlight(entry[1].cloneRange())
        return this.#resultFrom(entry)?.text
    }

    // get next text without moving the iterator
    prepare() {
        const entry = this.#list.prepare()
        return this.#resultFrom(entry)?.text
    }

    from(range) {
        this.#lastMark = null
        const entry = this.#list.find(range_ =>
            range.compareBoundaryPoints(Range.END_TO_START, range_) <= 0)
        if (entry?.[1]) this.highlight(entry[1].cloneRange())
        return this.#resultFrom(entry)?.text
    }

    getLastRange() {
        if (this.#lastMark) {
            const range = this.#ranges.get(this.#lastMark)
            if (range) return range.cloneRange()
        }
    }

    setMark(mark) {
        const range = this.#ranges.get(mark)
        if (range) {
            this.#lastMark = mark
            this.highlight(range.cloneRange())
            return range
        }
    }

    currentDetail() {
        const entry = this.#ensureCurrentEntry()
        return this.#resultFrom(entry)
    }

    collectDetails(count = 1, { includeCurrent = false, offset = 1 } = {}) {
        if (!Number.isFinite(count) || count <= 0) return []
        const details = []
        if (includeCurrent) {
            const entry = this.#ensureCurrentEntry()
            const detail = this.#resultFrom(entry)
            if (detail) details.push(detail)
        }
        const needed = count - details.length
        if (needed <= 0) return details
        const entries = this.#list.peek(needed, offset)
        for (const entry of entries) {
            const detail = this.#resultFrom(entry)
            if (detail) details.push(detail)
        }
        return details
    }

    highlightCfi(cfi) {
        if (!cfi) return null
        const entry = this.#list.find(range => {
            const candidate = this.#getCfi?.(range.cloneRange?.())
            return candidate === cfi
        })
        if (!entry) return null
        return this.#resultFrom(entry, { highlight: true })
    }
}
