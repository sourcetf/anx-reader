/**
 * The Unicode classes the reader matches on, in one place.
 *
 * Script classes come from the engine's own tables (`\p{Script=…}`) rather than
 * hardcoded blocks, so they follow whatever Unicode version the engine ships.
 * A WebView can be a version or two behind the standard, though, and a
 * Chinese-first reader cares about the newest ideographs in particular: Unicode
 * 17.0 (September 2025) added CJK Unified Ideographs Extension J
 * (U+323B0–U+3347F, 4,298 ideographs), which an engine still on Unicode 16
 * tables does not know is Han. The classes below add that block explicitly, so
 * a page set in it is treated as CJK — joined without spaces between lines,
 * converted with the simplified/traditional tables, segmented as words — no
 * matter how old the engine is.
 *
 * Text that crosses the WebView bridge or lands in the app's database also has
 * to survive being cut: slicing by UTF-16 index can leave half of a surrogate
 * pair behind, and a lone surrogate is not text — the bridge and SQLite carry it
 * as a replacement character. `truncate`/`truncateTail` cut on code point
 * boundaries instead.
 */

/** CJK Unified Ideographs Extension J, added in Unicode 17.0 (astral). */
export const CJK_EXTENSION_J = '\\u{323B0}-\\u{3347F}'

/** Scripts set without inter-word spaces, plus their punctuation blocks. */
export const NO_SPACE_SCRIPT = new RegExp(
    `[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}\\p{Script=Hangul}`
    + `\\u3000-\\u303F\\uFF00-\\uFFEF${CJK_EXTENSION_J}]`, 'u')

/** Han ideographs, the set the simplified/traditional tables can map. */
export const HAN = new RegExp(`[\\p{Script=Han}${CJK_EXTENSION_J}]`, 'u')

/** The same set with the `g` flag, for replacing every Han character in a string. */
export const HAN_GLOBAL = new RegExp(`[\\p{Script=Han}${CJK_EXTENSION_J}]`, 'gu')

/**
 * A code point → code point map from two parallel strings (the shape the
 * simplified/traditional tables are written in). Built by code point, so a
 * character the table does not know — any astral ideograph — is simply absent
 * and left as it is, instead of being looked up by an index that counts its two
 * UTF-16 units as two characters.
 */
export const codePointMap = (from, to) => {
    const table = new Map()
    const source = Array.from(from)
    const target = Array.from(to)
    source.forEach((char, i) => {
        const replacement = target[i]
        if (replacement) table.set(char, replacement)
    })
    return table
}

/** Cut `text` to at most `max` UTF-16 units, without splitting a code point. */
export const truncate = (text, max) => {
    if (typeof text !== 'string' || text.length <= max) return text
    let end = max
    const unit = text.charCodeAt(end - 1)
    if (unit >= 0xD800 && unit <= 0xDBFF) end -= 1
    return text.slice(0, end)
}

/** As `truncate`, for a tail (`text.slice(-max)`): never start on a low surrogate. */
export const truncateTail = (text, max) => {
    if (typeof text !== 'string' || text.length <= max) return text
    let start = text.length - max
    const unit = text.charCodeAt(start)
    if (unit >= 0xDC00 && unit <= 0xDFFF) start += 1
    return text.slice(start)
}
