/**
 * The reader's Unicode classes and its text cuts, checked against characters
 * from the newest versions of the standard: CJK Unified Ideographs Extension J
 * (Unicode 17.0, U+323B0–U+3347F) is astral — two UTF-16 units each — and no
 * engine shipped on older tables knows it is Han, so a page set in it would be
 * joined with spaces, skipped by the simplified/traditional conversion and cut
 * in half by an excerpt.
 *
 *   node unicode.test.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const SRC = join(here, '..', 'src')

let failures = 0
let checks = 0
const ok = (cond, label, extra = '') => {
  checks++
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`) }
}
const eq = (actual, expected, label) =>
  ok(Object.is(actual, expected), label, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`)

// The modules are ES modules; import a copy the loader accepts (the package has
// no "type": "module").
const scratch = join(tmpdir(), 'anx-unicode-test')
mkdirSync(scratch, { recursive: true })
const importModule = async (name) => {
  const target = join(scratch, name.replace(/\.js$/, '.mjs'))
  writeFileSync(target, readFileSync(join(SRC, name)))
  return await import(pathToFileURL(target).href)
}

const { HAN, HAN_GLOBAL, NO_SPACE_SCRIPT, truncate, truncateTail, codePointMap, CJK_EXTENSION_J } =
  await importModule('unicode.js')

// Characters under test
const EXT_J_FIRST = String.fromCodePoint(0x323B0)   // Unicode 17, Extension J
const EXT_J_LAST = String.fromCodePoint(0x3347F)
const EXT_I = String.fromCodePoint(0x2EBF0)         // Unicode 15.1, Extension I
const EXT_B = String.fromCodePoint(0x20000)         // Unicode 3.1, Extension B
const LATIN = 'A'
const HIRAGANA = 'あ'
const HANGUL = '한'
const EMOJI = '🙂'

console.log('\n[1] Han script, including the Unicode 17 extension')
ok(HAN.test(EXT_J_FIRST), 'Extension J (U+323B0) counts as Han')
ok(HAN.test(EXT_J_LAST), 'Extension J (U+3347F) counts as Han')
ok(HAN.test(EXT_I), 'Extension I (U+2EBF0) counts as Han')
ok(HAN.test(EXT_B), 'Extension B (U+20000) counts as Han')
ok(HAN.test('漢'), 'the basic block counts as Han')
ok(!HAN.test(LATIN) && !HAN.test(EMOJI), 'latin and emoji do not')
ok(HAN_GLOBAL.global && HAN_GLOBAL.unicode, 'the replacing class is global and Unicode-aware')

console.log('\n[2] no-space scripts (how a wrapped line is joined)')
ok(NO_SPACE_SCRIPT.test(EXT_J_FIRST), 'a line of Extension J is joined without a space')
ok(NO_SPACE_SCRIPT.test(HIRAGANA) && NO_SPACE_SCRIPT.test(HANGUL),
  'kana and hangul too')
ok(NO_SPACE_SCRIPT.test('。') && NO_SPACE_SCRIPT.test('，'), 'and full-width punctuation')
ok(!NO_SPACE_SCRIPT.test(LATIN), 'latin is not')

console.log('\n[3] cutting text never leaves half a code point')
const astralWord = `a${EXT_J_FIRST}b`
eq(astralWord.length, 4, 'the word is four UTF-16 units')
eq(truncate(astralWord, 4), astralWord, 'an exact cut keeps it whole')
eq(truncate(astralWord, 3), `a${EXT_J_FIRST}`, 'a cut after the pair keeps it whole')
eq(truncate(astralWord, 2), 'a', 'a cut between the halves backs off to the character before')
eq(truncate(astralWord, 1), 'a', 'and does not take the pair with it')
eq(truncate(astralWord, 0), '', 'a zero cut is empty')
ok(!/[\uD800-\uDBFF]$/.test(truncate(astralWord, 2)), 'no lone high surrogate at the end')

eq(truncateTail(astralWord, 4), astralWord, 'a whole tail is kept')
eq(truncateTail(astralWord, 3), `${EXT_J_FIRST}b`, 'the tail keeps the character whole')
eq(truncateTail(astralWord, 2), 'b', 'a tail cut between the halves drops them both')
ok(!/^[\uDC00-\uDFFF]/.test(truncateTail(astralWord, 2)), 'no lone low surrogate at the start')

eq(truncate('ab', 5), 'ab', 'a cut longer than the text is a no-op')
eq(truncateTail('ab', 5), 'ab', 'and so is the other direction')
eq(truncate('', 3), '', 'and an empty string stays empty')

console.log('\n[4] the conversion tables must not mangle what they cannot map')
// The reader's own table builder, on a table shaped like the real ones.
const pairs = codePointMap('漢閒', '汉闲')
const convert = text => text.replace(HAN_GLOBAL, match => pairs.get(match) ?? match)
eq(convert('漢閒'), '汉闲', 'every table entry in a string is converted')
eq(convert(`漢${EXT_J_FIRST}`), `汉${EXT_J_FIRST}`, 'an unmapped ideograph is left alone')
eq(convert(`${LATIN}${EMOJI}`), `${LATIN}${EMOJI}`, 'and everything non-Han')
ok(!convert(EXT_J_FIRST).includes('\uFFFD'), 'nothing turns into a replacement character')

console.log("\n[5] the reader's own tables: aligned, BMP-only, and correct where they map")
{
  const source = readFileSync(join(SRC, 'book.js'), 'utf8')
  const grab = name => source.match(new RegExp(`const ${name} = '([^']+)'`))[1]
  const zh_s = grab('zh_s')
  const zh_t = grab('zh_t')
  const simplified = Array.from(zh_s)
  const traditional = Array.from(zh_t)
  eq(simplified.length, traditional.length,
    `the two tables line up (${simplified.length} entries each)`)
  ok(simplified.every(c => c.codePointAt(0) <= 0xFFFF),
    'every entry is a single UTF-16 unit, so no index can be off by a pair')
  const converter = codePointMap(zh_s, zh_t)
  eq(converter.get('汉'), '漢', '汉 converts to its traditional form')
  eq(converter.get('们'), '們', 'and so does 们')
  eq(converter.get(EXT_J_FIRST), undefined, 'a Unicode 17 ideograph has no entry')
  eq(converter.get(EXT_B), undefined, 'nor does an astral Extension B one')
}

console.log('\n[6] the extension block is spelled the way the classes expect it')
ok(new RegExp(`[${CJK_EXTENSION_J}]`, 'u').test(EXT_J_FIRST),
  'the block constant matches its first code point')

console.log(`\n${failures ? 'FAILED' : 'PASSED'}: ${checks - failures}/${checks} checks`)
process.exit(failures ? 1 : 0)
