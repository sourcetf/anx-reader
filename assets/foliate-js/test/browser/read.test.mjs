/**
 * Drives the real reader page (assets/foliate-js/index.html + src/book.js) in a
 * real Chromium engine — the same engine family as Android WebView — with the
 * Flutter bridge stubbed, and checks what a PDF does end to end: page render,
 * zoom, page turns, scroll mode, search, paragraph-joined selection text,
 * highlights, TTS, bookmarks, the import metadata path.
 *
 *   node server.mjs &            # or start it yourself
 *   node read.test.mjs [port]
 *
 * Screenshots land in ./shots.
 */
import { chromium } from 'playwright'
import { mkdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const PORT = Number(process.argv[2] ?? 8085)
const BASE = `http://127.0.0.1:${PORT}`
const FIXTURES = process.env.ANX_PDF_FIXTURES ?? join(here, 'fixtures')
const PDF = join(FIXTURES, 'sample-alice.pdf')
const OUTLINE_PDF = join(FIXTURES, 'sample-alice-outline.pdf')
const SCAN_PDF = join(FIXTURES, 'sample-alice-scan.pdf')
const SHOTS = join(here, 'shots')
mkdirSync(SHOTS, { recursive: true })

let failures = 0
let checks = 0
const ok = (cond, label, extra = '') => {
  checks++
  if (cond) console.log(`  ok   ${label}`)
  else { failures++; console.log(`  FAIL ${label}${extra ? ` — ${extra}` : ''}`) }
}

const readerUrl = ({ file, importing = false, style = {} }) => {
  const params = {
    importing,
    url: `${BASE}/book/${encodeURIComponent(file)}`,
    initialCfi: '',
    style: {
      fontSize: 1.4, fontName: 'Arial', fontPath: '', fontWeight: 400, letterSpacing: 0,
      spacing: 1.8, paragraphSpacing: 1.0, textIndent: 0, fontColor: '#333333',
      backgroundColor: '#ffffff', topMargin: 90, bottomMargin: 50, sideMargin: 6,
      justify: true, hyphenate: false, pageTurnStyle: 'slide', maxColumnCount: 0,
      columnThreshold: 720, writingMode: 'horizontal-tb', textAlign: 'auto',
      backgroundImage: '', bgimgBlur: 0, bgimgOpacity: 1, bgimgFit: 'cover',
      allowScript: false, customCSS: '', customCSSEnabled: false, useBookStyles: false,
      headingFontSize: 1.0, codeHighlightTheme: 'off',
      pdfZoomMode: 'fit-page', pdfZoomLevel: 100, pdfSpreadMode: 'auto',
      pdfContrast: 100, pdfLockHorizontalPan: false, pdfApplyTheme: false,
      ...style,
    },
    readingRules: { convertChineseMode: 'none', bionicReadingMode: false },
  }
  const query = Object.entries(params)
    .map(([k, v]) => `${k}=${encodeURIComponent(JSON.stringify(v))}`)
    .join('&')
  return `${BASE}/foliate-js/index.html?${query}`
}

// The Dart side, stubbed: records every bridge call and answers the ones that
// expect a value.
const bridgeStub = () => {
  window.__calls = []
  window.__translate = { text: 'translated' }
  window.flutter_inappwebview = {
    callHandler: (name, data) => {
      window.__calls.push({ name, data })
      if (name === 'translateText') return Promise.resolve({ text: `[${data?.text ?? ''}]` })
      return Promise.resolve(null)
    },
  }
}

const calls = (page, name) => page.evaluate(
  (n) => window.__calls.filter(c => c.name === n).map(c => c.data), name)
const lastCall = async (page, name) => {
  const all = await calls(page, name)
  return all.at(-1)
}

const run = async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent: 'Mozilla/5.0 (Linux; Android 16; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) '
      + 'Chrome/141.0.0.0 Mobile Safari/537.36',
  })
  await context.addInitScript(bridgeStub)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', e => errors.push(String(e)))
  page.on('console', m => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })

  // -------------------------------------------------------------------------
  console.log('\n[1] a PDF opens and renders its first page')
  await page.goto(readerUrl({ file: PDF }))
  await page.waitForFunction(() => window.reader?.view?.isFixedLayout === true, { timeout: 60000 })
  await page.waitForFunction(() => {
    const contents = window.reader?.view?.renderer?.getContents?.() ?? []
    return contents.some(c => c.doc?.querySelector('#canvas > canvas'))
  }, { timeout: 60000 })

  const opened = await page.evaluate(() => {
    const view = window.reader.view
    const contents = view.renderer.getContents()
    const frame = contents.find(c => c.doc?.querySelector('#canvas > canvas'))
    const canvas = frame.doc.querySelector('#canvas > canvas')
    const textLayer = frame.doc.querySelector('.textLayer')
    return {
      isFixedLayout: view.isFixedLayout,
      pages: view.renderer.pages,
      index: view.renderer.index,
      spreads: view.renderer.pages,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      cssWidth: parseFloat(canvas.style.width),
      spans: textLayer.querySelectorAll('span').length,
      text: textLayer.textContent.slice(0, 60),
      hasAnnotationLayer: !!frame.doc.querySelector('.annotationLayer'),
      tocFirst: window.reader.toc?.[0] ?? null,
    }
  })
  ok(opened.isFixedLayout, 'the book is treated as fixed layout')
  ok(opened.canvasWidth > 600, `the page bitmap is rasterised (${opened.canvasWidth}x${opened.canvasHeight})`)
  ok(opened.canvasWidth > opened.cssWidth, 'the bitmap is over-sampled relative to its CSS box')
  ok(opened.spans > 20, `the text layer is built (${opened.spans} spans)`)
  ok(/Carroll|Alice|EDITION/i.test(opened.text), `the first page shows its text (“${opened.text.trim()}”)`)
  ok(opened.index === 0, `a PDF opens on its first page (index ${opened.index})`)
  ok(opened.hasAnnotationLayer, 'the annotation layer is in the page document')
  ok(Array.isArray(await page.evaluate(() => window.reader.toc)), 'the TOC was published to Dart')
  const tocCall = await lastCall(page, 'onSetToc')
  ok(Array.isArray(tocCall), 'and it arrived over the bridge')

  const relocation = await lastCall(page, 'onRelocated')
  ok(relocation?.cfi === 'epubcfi(/6/2)', `the first relocation is the first page's CFI (${relocation?.cfi})`)
  ok(relocation?.chapterCurrentPage === 1, 'Dart is told it is on page 1')
  ok(relocation?.chapterTotalPages > 10, `and that the book has ${relocation?.chapterTotalPages} pages`)
  await page.screenshot({ path: join(SHOTS, '01-first-page.png') })

  // -------------------------------------------------------------------------
  console.log('\n[2] zoom re-renders the bitmap instead of scaling it')
  const before = await page.evaluate(() => {
    const renderer = window.reader.view.renderer
    const doc = (renderer.getContents().find(c => c.index === renderer.index)
      ?? renderer.getContents()[0]).doc
    const canvas = doc.querySelector('#canvas > canvas')
    return { width: canvas.width, cssWidth: parseFloat(canvas.style.width) }
  })
  await page.evaluate(() => window.changeStyle({ pdfZoomMode: 'fit-width', pdfZoomLevel: 200 }))
  await page.waitForTimeout(1200)
  const after = await page.evaluate(() => {
    const renderer = window.reader.view.renderer
    const doc = (renderer.getContents().find(c => c.index === renderer.index)
      ?? renderer.getContents()[0]).doc
    const canvas = doc.querySelector('#canvas > canvas')
    return {
      width: canvas.width,
      cssWidth: parseFloat(canvas.style.width),
      scale: parseFloat(doc.documentElement.style.getPropertyValue('--scale-factor')),
      textLayerScale: parseFloat(doc.querySelector('.textLayer').style.getPropertyValue('--scale-factor')),
      overflowX: window.reader.view.renderer.isOverflowX,
    }
  })
  ok(after.width > before.width, `zooming rasterises at a higher resolution (${before.width} → ${after.width})`)
  ok(Math.abs(after.textLayerScale - after.scale) < 1e-6,
    'the text layer is laid out at the same scale as the bitmap')
  ok(after.cssWidth > before.cssWidth, 'the page box grows with the zoom')
  ok(after.overflowX === true, 'a zoomed page reports horizontal overflow (pannable)')
  await page.screenshot({ path: join(SHOTS, '02-zoomed-fit-width-200.png') })

  await page.evaluate(() => window.changeStyle({ pdfZoomMode: 'fit-page', pdfZoomLevel: 100 }))
  await page.waitForTimeout(1000)

  // -------------------------------------------------------------------------
  console.log('\n[3] page turns report page-granular progress')
  const beforeTurn = await page.evaluate(() => window.reader.view.renderer.index)
  await page.evaluate(() => window.nextPage())
  await page.waitForTimeout(1200)
  const turned = await page.evaluate(() => {
    const view = window.reader.view
    const doc = view.renderer.getContents().find(c => c.doc?.querySelector('.textLayer'))?.doc
    return {
      index: view.renderer.index,
      cfi: view.lastLocation?.cfi,
      text: doc?.querySelector('.textLayer')?.textContent?.slice(0, 40) ?? '',
      percentage: view.lastLocation?.fraction,
    }
  })
  ok(turned.index > beforeTurn, `nextPage() advances the renderer (${beforeTurn} → ${turned.index})`)
  ok(turned.cfi === `epubcfi(/6/${(turned.index + 1) * 2})`,
    `the reported CFI follows the page (${turned.cfi})`)
  ok(turned.percentage > 0, `progress moves with the page (${turned.percentage?.toFixed(3)})`)
  const secondPageRelocation = await lastCall(page, 'onRelocated')
  ok(secondPageRelocation?.bookCurrentPage != null, 'the relocation carries book-level position')
  await page.screenshot({ path: join(SHOTS, '03-page-two.png') })

  // -------------------------------------------------------------------------
  console.log('\n[4] the continuous scroll flow keeps a strip of pages')
  await page.evaluate(() => window.changeStyle({ pageTurnStyle: 'scroll' }))
  await page.waitForTimeout(2500)
  const scrolled = await page.evaluate(() => {
    const renderer = window.reader.view.renderer
    return {
      scrolled: renderer.scrolled,
      pages: renderer.pages,
      slots: renderer.shadowRoot.querySelectorAll('.scroll-page').length,
      loaded: renderer.shadowRoot.querySelectorAll('.scroll-page iframe').length,
    }
  })
  ok(scrolled.scrolled === true, 'the renderer switched to the scroll flow')
  ok(scrolled.slots > 60, `every page has a slot (${scrolled.slots})`)
  ok(scrolled.loaded > 0, `neighbouring pages load into the strip (${scrolled.loaded})`)
  await page.screenshot({ path: join(SHOTS, '04-scroll-mode.png') })
  await page.evaluate(() => window.changeStyle({ pageTurnStyle: 'slide' }))
  await page.waitForTimeout(1200)
  ok(await page.evaluate(() => !window.reader.view.renderer.scrolled), 'and back to paginated')

  // -------------------------------------------------------------------------
  console.log('\n[5] search finds text and marks it')
  await page.evaluate(async () => {
    window.__search = []
    const original = window.flutter_inappwebview.callHandler
    window.flutter_inappwebview.callHandler = (name, data) => {
      if (name === 'onSearch') window.__search.push(data)
      return original(name, data)
    }
  })
  await page.evaluate(() => window.search('Alice'))
  await page.waitForTimeout(4000)
  const search = await page.evaluate(() => {
    const results = window.__search.filter(r => r.subitems).flatMap(r => r.subitems)
    const done = window.__search.some(r => r.process === 1)
    const overlayerRects = window.reader.view.renderer.getContents()
      .map(c => c.overlayer?.element?.querySelectorAll('g')?.length ?? 0)
    return { count: results.length, first: results[0] ?? null, done, overlayerRects }
  })
  ok(search.count > 0, `searching the book returns matches (${search.count})`)
  ok(!!search.first?.excerpt?.match, `a match carries its excerpt (${JSON.stringify(search.first?.excerpt?.match)})`)
  ok(typeof search.first?.cfi === 'string' && search.first.cfi.startsWith('epubcfi'),
    'a match carries a CFI')
  ok(search.done, 'the search reports completion to Dart')
  ok(search.overlayerRects.some(n => n > 0), 'search hits are drawn on the page overlayer')
  await page.screenshot({ path: join(SHOTS, '05-search.png') })
  await page.evaluate(() => window.clearSearch())

  // -------------------------------------------------------------------------
  console.log('\n[6] selecting across a line break joins the lines')
  const selection = await page.evaluate(() => {
    const view = window.reader.view
    // A spread shows two frames; select the same line pair in each so whichever
    // one the reader last reported a load for has a live selection.
    const frames = view.renderer.getContents().filter(c => c.doc?.querySelector('.textLayer br'))
    if (!frames.length) return { skipped: 'no text layer with line breaks' }
    let shapes = []
    for (const frame of frames) {
      const doc = frame.doc
      const layer = doc.querySelector('.textLayer')
      const children = Array.from(layer.children)
      const brIndex = children.findIndex(el => el.tagName === 'BR')
      if (brIndex < 1) continue
      const before = children[brIndex - 1]
      const after = children[brIndex + 1]
      if (!before?.firstChild || !after?.firstChild) continue
      const range = doc.createRange()
      range.setStart(before.firstChild, 0)
      range.setEnd(after.firstChild, after.firstChild.data.length)
      const sel = doc.getSelection()
      sel.removeAllRanges()
      sel.addRange(range)
      shapes.push({ raw: range.toString(), rects: range.getClientRects().length })
    }
    if (!shapes.length) return { skipped: 'no line break found' }
    window.showContextMenu() // what the app calls to report a selection
    return { shapes }
  })
  if (selection.skipped) {
    ok(false, 'a text layer with line breaks is available', selection.skipped)
  } else {
    const payload = await lastCall(page, 'onSelectionEnd')
    ok(!!payload, 'the selection reached Dart')
    ok(/ /.test(payload?.text ?? '') && !/[\u4e00-\u9fff]/.test(payload?.text ?? ''),
      `the selection text reads as a sentence (“${payload?.text?.slice(0, 60)}”)`)
    ok(payload?.text?.trim() === payload?.text?.trim().replace(/\s+/g, ' ')
      || payload?.text?.includes('\n'),
      'line wraps are joined (a break became a space or a paragraph)')
    ok(payload?.cfi?.startsWith('epubcfi'), `the selection carries a CFI (${payload?.cfi?.slice(0, 40)})`)
    ok(!!payload?.pos && payload.pos.left >= 0, 'and a screen position for the menu')
    // A PDF selection is highlightable, so it must not arrive flagged as a
    // footnote (that flag hides the highlight colours); only the reader note
    // stays unavailable, which `fixedLayout` says.
    ok(payload?.footnote === false, `a PDF selection is not a footnote (${payload?.footnote})`)
    ok(payload?.fixedLayout === true, 'and is reported as a fixed-layout page')

    // -----------------------------------------------------------------------
    console.log('\n[7] a highlight lands on the page as SVG')
    const selectionCfi = (await lastCall(page, 'onSelectionEnd'))?.cfi ?? null
    const highlight = await page.evaluate(async (cfi) => {
      if (!cfi) return { groups: 0, hasPath: false, rect: null, html: '' }
      const view = window.reader.view
      const resolved = await view.resolveNavigation(cfi)
      const index = resolved?.index
      await view.addAnnotation({ value: cfi, type: 'highlight', color: '#ffcc00' })
      await new Promise(r => setTimeout(r, 400))
      const frame = view.renderer.getContents().find(c => c.index === index)
      const svg = frame?.overlayer?.element
      const groups = svg?.querySelectorAll('g')?.length ?? 0
      // the drawn highlight carries the colour; <defs>/<clipPath> do not
      const shape = svg?.querySelector('g[fill]') ?? null
      const box = shape?.getBoundingClientRect?.() ?? null
      return {
        groups,
        hasPath: !!shape?.querySelector('path,rect'),
        rect: box ? { x: box.x, y: box.y, w: box.width, h: box.height } : null,
        html: svg?.innerHTML?.slice(0, 120) ?? '',
      }
    }, (await lastCall(page, 'onSelectionEnd'))?.cfi ?? null)
    ok(highlight.groups > 0, `the highlight was drawn (${highlight.groups} shapes)`)
    ok(highlight.hasPath, 'the highlight has geometry')
    ok((highlight.rect?.w ?? 0) > 0 && (highlight.rect?.h ?? 0) > 0,
      `the highlight has a real size (${JSON.stringify(highlight.rect)})`)
    await page.screenshot({ path: join(SHOTS, '07-highlight.png') })
  }

  // -------------------------------------------------------------------------
  console.log('\n[8] TTS reads the page text layer')
  const tts = await page.evaluate(async () => {
    window.initTts()
    const first = await window.ttsNext()
    const detail = window.ttsCurrentDetail?.()
    window.ttsStop()
    return {
      first: typeof first === 'string' ? first : JSON.stringify(first),
      detail: typeof detail === 'object'
        ? { cfi: detail?.cfi, text: detail?.text?.slice(0, 40) }
        : String(detail),
    }
  })
  ok(typeof tts.first === 'string' && tts.first.length > 10,
    `TTS returns a sentence from the page (“${String(tts.first).slice(0, 50)}”)`)
  ok(tts.detail?.cfi?.startsWith('epubcfi'), `each sentence carries a CFI (${tts.detail?.cfi})`)

  // The narrate button asks for the range at the current position, and a page in
  // a fixed-layout book has none — it must still start rather than throw.
  const ttsHere = await page.evaluate(() => {
    window.initTts()
    const first = window.ttsHere()
    return typeof first === 'string' ? first : JSON.stringify(first)
  })
  ok(typeof ttsHere === 'string' && ttsHere.length > 5,
    `the narrate entry point returns a sentence (“${String(ttsHere).slice(0, 50)}”)`)
  const rangeErrors = errors.filter(e => /compareBoundaryPoints/.test(e))
  ok(rangeErrors.length === 0, 'and does not throw on a page with no range',
    rangeErrors.slice(0, 2).join(' | '))

  // -------------------------------------------------------------------------
  console.log('\n[9] bookmarks no longer crash a fixed-layout page')
  await page.evaluate(() => window.addBookmarkHere())
  await page.waitForTimeout(400)
  const bookmark = await lastCall(page, 'handleBookmark')
  ok(!!bookmark, 'the bookmark request reached Dart')
  ok(bookmark?.detail?.cfi?.startsWith('epubcfi'), `the bookmark carries a CFI (${bookmark?.detail?.cfi})`)
  ok(bookmark?.remove === false, 'and is an add')

  // -------------------------------------------------------------------------
  console.log('\n[10] the import path extracts metadata and a cover')
  const importPage = await context.newPage()
  importPage.on('pageerror', e => errors.push(`import: ${String(e)}`))
  await importPage.goto(readerUrl({ file: PDF, importing: true }))
  await importPage.waitForFunction(() => window.__calls.some(c => c.name === 'onMetadata'), { timeout: 60000 })
  const metadata = await lastCall(importPage, 'onMetadata')
  ok(!!metadata, 'metadata was reported')
  ok(!!metadata?.cover?.startsWith('data:image/'), 'a cover image was rendered')
  ok(typeof metadata?.title === 'string', `the title was read (“${metadata?.title}”)`)
  await importPage.close()

  // -------------------------------------------------------------------------
  console.log('\n[11] the PDF theme colours reach the page bitmap')
  // A page lives in its own iframe; a filter kept in the reader document cannot
  // be referenced from there, so book.js rebuilds it inside the page and paints
  // the bitmap through it from CSS.
  const theme = await page.evaluate(async () => {
    window.changeStyle({
      pdfApplyTheme: true, backgroundColor: '#040404ff', fontColor: '#ffffe0ff',
    })
    await new Promise(resolve => setTimeout(resolve, 1500))
    const contents = window.reader.view.renderer.getContents()
    const frame = contents.find(c => c.doc?.querySelector('#canvas > canvas'))
    const doc = frame?.doc
    const canvas = doc?.querySelector('#canvas > canvas')
    if (!doc || !canvas) return { missing: true }
    const root = doc.getElementById('anx-page-colors-root')
    const filter = root?.querySelector('filter#anx-page-colors')
    // Paint a copy of the bitmap in the page's own document, through the same
    // filter the stylesheet puts on the canvas, and read the result back.
    const scratch = doc.createElement('canvas')
    scratch.width = canvas.width
    scratch.height = canvas.height
    const ctx = scratch.getContext('2d')
    ctx.filter = canvas.style.filter || getComputedStyle(canvas).filter
    ctx.drawImage(canvas, 0, 0)
    const pixel = Array.from(ctx.getImageData(Math.round(canvas.width / 2),
      Math.round(canvas.height * 0.2), 1, 1).data)
    return {
      hasRoot: !!root,
      filterChildren: filter ? filter.children.length : 0,
      canvasFilter: canvas.style.filter || getComputedStyle(canvas).filter,
      pixel,
    }
  })
  ok(theme.hasRoot, 'the page document carries the theme filter')
  ok(theme.filterChildren === 3, `the filter maps gamma, greys and the theme ramp (${theme.filterChildren})`)
  ok(/url\(["']?#anx-page-colors["']?\)/.test(theme.canvasFilter ?? ''),
    `the bitmap is painted through it (${theme.canvasFilter})`)
  ok((theme.pixel?.[0] ?? 255) < 40 && (theme.pixel?.[1] ?? 255) < 40,
    `the page comes out dark (${JSON.stringify(theme.pixel)})`)

  // -------------------------------------------------------------------------
  console.log('\n[12] the TOC places every outline entry on the page it points at')
  const tocPage = await context.newPage()
  tocPage.on('pageerror', e => errors.push(`toc: ${String(e)}`))
  await tocPage.goto(readerUrl({ file: OUTLINE_PDF }))
  await tocPage.waitForFunction(() => window.reader?.view?.isFixedLayout === true, { timeout: 60000 })
  await tocPage.waitForFunction(() => (window.reader?.toc ?? []).length > 0, { timeout: 60000 })
  const toc = await tocPage.evaluate(() => {
    const sections = window.reader.view.book?.sections?.length ?? 0
    const flat = []
    const walk = items => (items ?? []).forEach(i => { flat.push(i); walk(i.subitems) })
    walk(window.reader.toc)
    const mismatched = flat.filter(i =>
      Math.abs(i.startPercentage * sections - i.startPage) > 0.001)
    return {
      sections,
      count: flat.length,
      first: flat[0] && { label: flat[0].label, page: flat[0].startPage, pct: flat[0].startPercentage },
      mismatched: mismatched.slice(0, 3).map(i => ({ label: i.label, page: i.startPage, pct: i.startPercentage })),
    }
  })
  ok(toc.count > 0, `the outline reached the app (${toc.count} entries)`)
  ok(toc.mismatched.length === 0,
    `every entry's percentage is its own page's share of the book (first: ${JSON.stringify(toc.first)})`,
    JSON.stringify(toc.mismatched))
  await tocPage.close()

  // -------------------------------------------------------------------------
  console.log('\n[13] OCR turns a long press on a scanned page into a selection')
  // The page is a bitmap with no text of its own, so a press is held until the
  // reader asks the app to OCR it. The app side is stubbed here with two words
  // placed where the fixture's text is; what is under test is everything around
  // it: the hold detection, the request, the text layer that comes back, the
  // selection it drives and the menu payload that follows.
  const scanPage = await context.newPage()
  scanPage.on('pageerror', e => errors.push(`ocr: ${String(e)}`))
  scanPage.on('console', m => {
    if (m.type() === 'error') errors.push(`ocr console: ${m.text()}`)
  })
  await scanPage.bringToFront()
  await scanPage.addInitScript(() => {
    window.__ocrRequests = 0
    window.__ocrAnswer = { ok: false, reason: 'stub' }
    const original = window.flutter_inappwebview.callHandler
    window.flutter_inappwebview.callHandler = (name, data) => {
      if (name === 'ocrPage') {
        window.__ocrRequests++
        original(name, data)   // keep the call in the harness's log
        return Promise.resolve(window.__ocrAnswer)
      }
      return original(name, data)
    }
  })
  await scanPage.goto(readerUrl({ file: SCAN_PDF }))
  await scanPage.waitForFunction(() => window.reader?.view?.isFixedLayout === true, { timeout: 60000 })
  await scanPage.waitForFunction(() => {
    const contents = window.reader?.view?.renderer?.getContents?.() ?? []
    return contents.some(c => c.doc?.querySelector('#canvas > canvas')?.width > 0)
  }, { timeout: 60000 })

  const scanned = await scanPage.evaluate(() => {
    const view = window.reader.view
    const frame = view.renderer.getContents().find(c => c.doc?.querySelector('#canvas > canvas'))
    const doc = frame.doc
    const canvas = doc.querySelector('#canvas > canvas')
    const layer = doc.querySelector('.textLayer')
    const box = canvas.getBoundingClientRect()
    return {
      pages: view.renderer.pages,
      spans: layer.querySelectorAll('span').length,
      text: layer.textContent.trim(),
      box: { x: box.x, y: box.y, w: box.width, h: box.height },
    }
  })
  ok(scanned.spans === 0 && scanned.text === '',
    `a scanned page carries no selectable text (${scanned.spans} spans)`)

  // Two words, as fractions of the page: what an OCR engine reports is bitmap
  // pixels, so the stub converts them against the live canvas the way ML Kit's
  // answer would arrive.
  // The third word is set in Unicode 17's CJK Unified Ideographs Extension J
  // (U+323B0..U+3347F): astral, so each ideograph is a surrogate pair, and no
  // engine on older Unicode tables knows it is Han.
  const ASTRAL_WORD = String.fromCodePoint(0x323B0, 0x323B1)
  const words = [
    { text: 'Alice', x: 0.12, y: 0.18, w: 0.30, h: 0.05 },
    { text: 'rabbit', x: 0.12, y: 0.42, w: 0.36, h: 0.05 },
    { text: ASTRAL_WORD, x: 0.12, y: 0.60, w: 0.30, h: 0.05 },
    { text: '汉字', x: 0.12, y: 0.70, w: 0.30, h: 0.05 },
  ]
  const answerWith = (list) => scanPage.evaluate((words) => {
    const renderer = window.reader.view.renderer
    const doc = (renderer.getContents().find(c => c.index === renderer.index)
      ?? renderer.getContents()[0]).doc
    const canvas = doc.querySelector('#canvas > canvas')
    window.__ocrAnswer = { ok: true, words: words.map(word => ({
      text: word.text,
      x: word.x * canvas.width, y: word.y * canvas.height,
      w: word.w * canvas.width, h: word.h * canvas.height,
    })) }
  }, list)
  await answerWith(words)

  // A long press with no movement, dispatched into the page's own document so
  // the coordinates are the page's, exactly as on a device. A spread keeps more
  // than one page on screen, so the press goes to the page the reader is on.
  const pressAt = async (nx, ny) => {
    await scanPage.evaluate(({ nx, ny }) => {
      const renderer = window.reader.view.renderer
      const doc = (renderer.getContents().find(c => c.index === renderer.index)
        ?? renderer.getContents()[0]).doc
      const canvas = doc.querySelector('#canvas > canvas')
      const box = canvas.getBoundingClientRect()
      const x = box.x + box.width * nx
      const y = box.y + box.height * ny
      const view = doc.defaultView
      const target = doc.elementFromPoint(x, y) ?? canvas
      const touch = new view.Touch({
        identifier: 1, target, clientX: x, clientY: y, screenX: x, screenY: y,
        pageX: x, pageY: y, radiusX: 10, radiusY: 10, force: 1,
      })
      const make = type => new view.TouchEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        touches: type === 'touchend' ? [] : [touch],
        targetTouches: type === 'touchend' ? [] : [touch],
        changedTouches: [touch],
      })
      target.dispatchEvent(make('touchstart'))
      window.__pressRelease = () => target.dispatchEvent(make('touchend'))
    }, { nx, ny })
    await scanPage.waitForTimeout(600)   // longer than the reader's hold threshold
    await scanPage.evaluate(() => window.__pressRelease())
  }

  await pressAt(0.25, 0.20)
  await scanPage.waitForTimeout(1500)
  const ocr = await scanPage.evaluate(() => {
    const view = window.reader.view
    const doc = view.renderer.getContents().find(c => c.doc?.querySelector('#canvas > canvas')).doc
    const layer = doc.querySelector('.textLayer')
    const spans = Array.from(layer.querySelectorAll('span[data-ocr-word]'))
    const selection = doc.getSelection()
    return {
      requests: window.__ocrRequests,
      spans: spans.length,
      first: spans[0]?.textContent ?? null,
      firstBox: spans[0]?.getBoundingClientRect?.() ?? null,
      selected: selection?.toString?.() ?? '',
    }
  })
  const ocrCall = await lastCall(scanPage, 'ocrPage')
  const ocrPayload = await lastCall(scanPage, 'onSelectionEnd')
  ok(ocr.requests === 1, `the hold asked the app to OCR the page (${ocr.requests} request)`)
  ok(String(ocrCall?.image ?? '').startsWith('data:image/png;base64,'),
    `the request carries the page bitmap (${String(ocrCall?.image ?? '').slice(0, 30)}…)`)
  ok(ocrCall?.page === 0, 'and the page it came from')
  ok(ocr.spans === words.length, `the words came back as a text layer (${ocr.spans} spans)`)
  ok(ocr.first === words[0].text, `the layer holds the recognised words (“${ocr.first}”)`)
  ok(Math.abs((ocr.firstBox?.width ?? 0) - scanned.box.w * words[0].w) < 2,
    `a word is laid out where the image says (${ocr.firstBox?.width?.toFixed(1)}px wide)`)
  ok(ocr.selected === words[0].text, `the press selected the word under it (“${ocr.selected}”)`)
  ok(ocrPayload?.text === words[0].text,
    `and the selection reached Dart (“${ocrPayload?.text}”)`)
  ok(String(ocrPayload?.cfi ?? '').startsWith('epubcfi'),
    `with a CFI (${String(ocrPayload?.cfi).slice(0, 40)})`)
  ok(ocrPayload?.fixedLayout === true && ocrPayload?.footnote === false,
    'the payload says it is a highlightable fixed-layout selection')
  await scanPage.screenshot({ path: join(SHOTS, '13-ocr-selection.png') })

  // The words are handed to the app so the page keeps its text across sessions:
  // the boxes arrived as bitmap pixels, so what is saved is their fraction of
  // the page, which survives a re-render at another zoom.
  // A word made of astral characters has to survive the whole path: the layer,
  // the selection, the CFI and the payload the app stores.
  await pressAt(0.27, 0.625)
  await scanPage.waitForTimeout(1500)
  const astral = await scanPage.evaluate(() => {
    const renderer = window.reader.view.renderer
    const doc = (renderer.getContents().find(c => c.index === renderer.index)
      ?? renderer.getContents()[0]).doc
    const span = doc.querySelector('.textLayer span[data-ocr-word="2"]')
    return {
      text: span?.textContent ?? null,
      units: span?.textContent?.length ?? 0,
      selected: doc.getSelection()?.toString?.() ?? '',
    }
  })
  const astralPayload = await lastCall(scanPage, 'onSelectionEnd')
  ok(astral.text === ASTRAL_WORD,
    `a Unicode 17 ideograph word is laid out whole (${astral.units} UTF-16 units for 2 ideographs)`)
  ok(astral.selected === ASTRAL_WORD, `and selected whole (“${astral.selected}”)`)
  ok(astralPayload?.text === ASTRAL_WORD, 'and reaches the app whole')
  ok(!/[\uD800-\uDBFF]$/.test(astralPayload?.text ?? '')
    && !/^[\uDC00-\uDFFF]/.test(astralPayload?.text ?? ''),
    'with no half of a surrogate pair anywhere in it')
  await scanPage.screenshot({ path: join(SHOTS, '13-ocr-astral.png') })

  // A reading rule that rewrites text (simplified to traditional) must leave a
  // fixed-layout page alone: its glyphs are baked into the bitmap, so converted
  // text would no longer be the text on the page — and for a recognised word it
  // would no longer be what the image says either.
  const converted = await scanPage.evaluate(async () => {
    window.readingFeatures({ convertChineseMode: 's2t' })
    await new Promise(resolve => setTimeout(resolve, 300))
    const renderer = window.reader.view.renderer
    const doc = (renderer.getContents().find(c => c.index === renderer.index)
      ?? renderer.getContents()[0]).doc
    const spans = Array.from(doc.querySelectorAll('.textLayer span[data-ocr-word]'))
    return {
      han: spans.find(s => s.dataset.ocrWord === '3')?.textContent ?? null,
      astral: spans.find(s => s.dataset.ocrWord === '2')?.textContent ?? null,
      astralUnits: spans.find(s => s.dataset.ocrWord === '2')?.textContent?.length ?? 0,
    }
  })
  ok(converted.han === '汉字', `a scanned page keeps the text the image has (“${converted.han}”)`)
  ok(converted.astral === ASTRAL_WORD && converted.astralUnits === 4,
    'and the Unicode 17 ideographs stay whole in it')
  ok(!converted.astral.includes('\uFFFD'), 'with nothing turned into a replacement character')

  const saved = await lastCall(scanPage, 'ocrSave')
  ok(saved?.page === 0 && saved?.words?.length === words.length,
    `the words are handed to the app (${saved?.words?.length} of them)`)
  ok(saved?.words?.every(w => w.x >= 0 && w.x <= 1 && w.y >= 0 && w.y <= 1 && w.w > 0 && w.w <= 1),
    'as fractions of the page, not bitmap pixels')
  ok(saved?.words?.[0]?.text === words[0].text, `carrying the text (“${saved?.words?.[0]?.text}”)`)

  // A zoom re-renders the page and clears the text layer with the bitmap. The
  // words are kept per page, so the next press rebuilds the layer without asking
  // the app again — and, since the boxes are fractions of the page, the same word
  // yields the same CFI at any zoom (a highlight made at one zoom has to resolve
  // at another).
  await scanPage.evaluate(async () => {
    window.changeStyle({ pdfZoomMode: 'fit-width', pdfZoomLevel: 200 })
    await new Promise(resolve => setTimeout(resolve, 1800))
  })
  const afterZoom = await scanPage.evaluate(() => {
    const renderer = window.reader.view.renderer
    const doc = (renderer.getContents().find(c => c.index === renderer.index)
      ?? renderer.getContents()[0]).doc
    const canvas = doc.querySelector('#canvas > canvas')
    const spans = Array.from(doc.querySelectorAll('.textLayer span[data-ocr-word]'))
    return {
      canvasWidth: canvas.width,
      spans: spans.length,
      width: spans[0]?.getBoundingClientRect?.().width ?? 0,
    }
  })
  ok(afterZoom.canvasWidth > scanned.box.w, `the zoom re-rasterised the bitmap (${afterZoom.canvasWidth}px)`)
  ok(afterZoom.spans === words.length,
    `and the page is re-rendered with its words (${afterZoom.spans} spans)`)
  ok(afterZoom.width > ocr.firstBox.width,
    `laid out for the new page size (${ocr.firstBox.width.toFixed(1)} → ${afterZoom.width.toFixed(1)}px)`)

  await pressAt(0.25, 0.20)
  await scanPage.waitForTimeout(1500)
  const rebuilt = await scanPage.evaluate(() => {
    const renderer = window.reader.view.renderer
    const doc = (renderer.getContents().find(c => c.index === renderer.index)
      ?? renderer.getContents()[0]).doc
    return {
      requests: window.__ocrRequests,
      spans: doc.querySelectorAll('.textLayer span[data-ocr-word]').length,
      selected: doc.getSelection()?.toString?.() ?? '',
    }
  })
  const zoomPayload = await lastCall(scanPage, 'onSelectionEnd')
  ok(rebuilt.requests === 1, `the words are remembered, not recognised twice (${rebuilt.requests} request)`)
  ok(rebuilt.spans === words.length, `they are still there for the press (${rebuilt.spans} spans)`)
  ok(rebuilt.selected === words[0].text, `the same word is under the same point (“${rebuilt.selected}”)`)
  ok(!!zoomPayload?.cfi && zoomPayload.cfi === ocrPayload.cfi,
    `and its CFI does not move with the zoom (${String(zoomPayload?.cfi).slice(0, 40)})`)

  // A press does not always land inside a word's box: between two words, or in
  // the leading above a line, it lands in a gap. It must still mean the word the
  // reader aimed at — the nearest one on that line — and never a word on another.
  const betweenWords = await scanPage.evaluate(() => {
    const renderer = window.reader.view.renderer
    const doc = (renderer.getContents().find(c => c.index === renderer.index)
      ?? renderer.getContents()[0]).doc
    const spans = Array.from(doc.querySelectorAll('.textLayer span[data-ocr-word]'))
    const [first, second] = [spans[0], spans[1]]
    const a = first.getBoundingClientRect()
    const b = second.getBoundingClientRect()
    const canvas = doc.querySelector('#canvas > canvas').getBoundingClientRect()
    // The middle of the gap between the two words, a little above their baseline
    // so the point is outside both boxes.
    return {
      first: first.textContent, second: second.textContent,
      point: { x: (a.right + b.left) / 2, y: a.top - 1 },
      canvas: { w: canvas.width, h: canvas.height },
    }
  })
  const pressGapPoint = async () => {
    await scanPage.evaluate((point) => {
      const renderer = window.reader.view.renderer
    const doc = (renderer.getContents().find(c => c.index === renderer.index)
      ?? renderer.getContents()[0]).doc
      const canvas = doc.querySelector('#canvas > canvas')
      const box = canvas.getBoundingClientRect()
      const x = box.left + point.x
      const y = box.top + point.y
      const view = doc.defaultView
      const target = doc.elementFromPoint(x, y) ?? canvas
      const touch = new view.Touch({ identifier: 1, target, clientX: x, clientY: y,
        screenX: x, screenY: y, pageX: x, pageY: y, radiusX: 10, radiusY: 10, force: 1 })
      const make = type => new view.TouchEvent(type, {
        bubbles: true, cancelable: true, composed: true,
        touches: type === 'touchend' ? [] : [touch], targetTouches: type === 'touchend' ? [] : [touch],
        changedTouches: [touch],
      })
      target.dispatchEvent(make('touchstart'))
      window.__releaseGap = () => target.dispatchEvent(make('touchend'))
    }, betweenWords.point)
    await scanPage.waitForTimeout(600)
    await scanPage.evaluate(() => window.__releaseGap())
    await scanPage.waitForTimeout(1200)
    return scanPage.evaluate(() => {
      const renderer = window.reader.view.renderer
    const doc = (renderer.getContents().find(c => c.index === renderer.index)
      ?? renderer.getContents()[0]).doc
      return doc.getSelection()?.toString?.() ?? ''
    })
  }
  const gapSelection = await pressGapPoint()
  ok(gapSelection === betweenWords.first || gapSelection === betweenWords.second,
    `a press in the gap between two words picks one of them (“${gapSelection}”, between “${betweenWords.first}” and “${betweenWords.second}”)`)

  // A drag that starts on a live selection is adjusting it: the page must not
  // turn out from under the finger.
  const handleDrag = await scanPage.evaluate(async () => {
    const view = window.reader.view
    const doc = view.renderer.getContents().find(c => c.doc?.querySelector('#canvas > canvas')).doc
    const span = doc.querySelector('.textLayer span[data-ocr-word]')
    const range = doc.createRange()
    range.setStart(span.firstChild, 0)
    range.setEnd(span.firstChild, span.firstChild.data.length)
    const selection = doc.defaultView.getSelection()
    selection.removeAllRanges()
    selection.addRange(range)
    const rect = span.getBoundingClientRect()
    const startPage = view.renderer.index
    // From the right edge of the selection, well to the right of it: exactly the
    // gesture that used to be read as a page turn.
    const canvas = doc.querySelector('#canvas > canvas')
    const box = canvas.getBoundingClientRect()
    const startX = box.left + rect.right + 4
    const y = box.top + rect.top + rect.height / 2
    const target = doc.elementFromPoint(startX, y) ?? canvas
    const touch = (x) => new doc.defaultView.Touch({ identifier: 1, target, clientX: x, clientY: y,
      screenX: x, screenY: y, pageX: x, pageY: y, radiusX: 10, radiusY: 10, force: 1 })
    const make = (type, x) => new doc.defaultView.TouchEvent(type, {
      bubbles: true, cancelable: true, composed: true,
      touches: type === 'touchend' ? [] : [touch(x)],
      targetTouches: type === 'touchend' ? [] : [touch(x)],
      changedTouches: [touch(x)],
    })
    target.dispatchEvent(make('touchstart', startX))
    for (const step of [20, 40, 60, 80, 100]) {
      target.dispatchEvent(make('touchmove', startX + step))
      await new Promise(r => setTimeout(r, 60))
    }
    target.dispatchEvent(make('touchend', startX + 100))
    await new Promise(r => setTimeout(r, 800))
    return { startPage, endPage: view.renderer.index, selection: doc.getSelection()?.toString?.() ?? '' }
  })
  ok(handleDrag.endPage === handleDrag.startPage,
    `dragging from a selection does not turn the page (${handleDrag.startPage} → ${handleDrag.endPage})`)
  ok(handleDrag.selection.includes(betweenWords.first),
    `and the selection survives the drag (“${handleDrag.selection}”)`)

  // A page of the kind a book actually has: a line of display text, a drawing
  // that OCR reads bits of lettering out of, then ordinary body text. The
  // display line and the drawing's words are several times the height of a body
  // word, and a press on the body must still be answered with the body. It runs
  // on a page not recognised yet: a page's words are kept once read, so this
  // answer has to be the one that page is read with.
  const illustrated = [
    { text: 'WONDERLAND', x: 0.08, y: 0.05, w: 0.62, h: 0.05 },
    { text: 'XXX', x: 0.16, y: 0.48, w: 0.20, h: 0.058 },
    { text: 'Alice', x: 0.12, y: 0.60, w: 0.08, h: 0.019 },
    { text: 'was', x: 0.22, y: 0.60, w: 0.05, h: 0.019 },
    { text: 'beginning', x: 0.29, y: 0.60, w: 0.12, h: 0.019 },
  ]
  const illustratedPage = await scanPage.evaluate(async () => {
    window.changeStyle({ pdfZoomMode: 'fit-page', pdfZoomLevel: 100 })
    window.nextPage()
    await new Promise(resolve => setTimeout(resolve, 2000))
    return window.reader.view.renderer.index
  })
  await answerWith(illustrated)
  await pressAt(0.245, 0.609)          // 'was', between 'Alice' and 'beginning'
  await scanPage.waitForTimeout(1200)
  const onBody = await scanPage.evaluate(() => {
    const renderer = window.reader.view.renderer
    const doc = (renderer.getContents().find(c => c.index === renderer.index)
      ?? renderer.getContents()[0]).doc
    return doc.getSelection()?.toString?.() ?? ''
  })
  ok(illustratedPage > 0 && onBody === 'was',
    `a press on body text selects the body word (“${onBody}”, page ${illustratedPage})`)

  // The other lines answer for themselves: a press inside the drawing gets the
  // drawing's own word, one in the gap between two body words gets a body word,
  // and one on the display line gets the display line — the size of the words
  // around a press must not decide which line it belongs to.
  const byLine = {}
  for (const [name, nx, ny] of [
    ['drawing', 0.25, 0.50],
    ['body gap', 0.205, 0.609],
    ['display', 0.35, 0.07],
  ]) {
    await pressAt(nx, ny)
    await scanPage.waitForTimeout(1200)
    byLine[name] = await scanPage.evaluate(() => {
      const renderer = window.reader.view.renderer
      const doc = (renderer.getContents().find(c => c.index === renderer.index)
        ?? renderer.getContents()[0]).doc
      return doc.getSelection()?.toString?.() ?? ''
    })
  }
  ok(byLine.drawing === 'XXX', `a press inside the drawing gets its own word (“${byLine.drawing}”)`)
  ok(byLine['body gap'] === 'Alice' || byLine['body gap'] === 'was',
    `a press between two body words gets a body word (“${byLine['body gap']}”)`)
  ok(byLine.display === 'WONDERLAND', `a press on the display line gets that line (“${byLine.display}”)`)

  // Back to a body word: that is the selection the grips below adjust.
  await pressAt(0.245, 0.609)
  await scanPage.waitForTimeout(1200)

  // The two grips of the selection: the WebView draws the selection itself but
  // gives a selection made in script nothing to drag, so the reader draws its
  // own and a finger on one of them adjusts the range.
  const handles = await scanPage.evaluate(() => {
    const renderer = window.reader.view.renderer
    const doc = (renderer.getContents().find(c => c.index === renderer.index)
      ?? renderer.getContents()[0]).doc
    const drawn = Array.from(doc.querySelectorAll('.anx-handles .anx-handle'))
    return drawn.map(h => ({ side: h.dataset.anxHandle, w: h.getBoundingClientRect().width }))
  })
  ok(handles.length === 2 && handles.every(h => h.w > 0),
    `a selection on a recognised page has two handles (${handles.map(h => h.side).join(', ') || 'none'})`)

  // A finger that comes down on a grip and stays there — a long press, which
  // still reports moves at the same point — is not asking to resize anything.
  // The press lands inside the gap the grip reaches into, and nearer the next
  // word than the one held: had those moves been applied, the word would have
  // been swallowed and the range would have swallowed the next one instead.
  const tapped = await scanPage.evaluate(async () => {
    const doc = window.reader.view.renderer.getContents().find(c => c.doc?.querySelector('#canvas > canvas')).doc
    const rect = sel => doc.querySelector(sel).getBoundingClientRect()
    const grip = rect('.anx-handles .anx-handle[data-anx-handle="end"]')
    const was = rect('.textLayer span[data-ocr-word="3"]')
    const next = rect('.textLayer span[data-ocr-word="4"]')
    const at = { x: was.right + (next.left - was.right) * 0.75, y: grip.top + grip.height / 2 }
    const onGrip = Math.abs(at.x - (grip.left + grip.width / 2)) <= 24
    const before = doc.getSelection()?.toString() ?? ''
    const el = doc.elementFromPoint(at.x, at.y) ?? doc.querySelector('#canvas > canvas')
    const make = (type, p) => {
      const touch = new doc.defaultView.Touch({ identifier: 1, target: el,
        clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y,
        pageX: p.x, pageY: p.y, radiusX: 10, radiusY: 10, force: 1 })
      return new doc.defaultView.TouchEvent(type, { bubbles: true, cancelable: true,
        composed: true, touches: type === 'touchend' ? [] : [touch],
        targetTouches: type === 'touchend' ? [] : [touch], changedTouches: [touch] })
    }
    el.dispatchEvent(make('touchstart', at))
    for (let i = 0; i < 6; i++) {
      el.dispatchEvent(make('touchmove', at))
      await new Promise(r => setTimeout(r, 60))
    }
    el.dispatchEvent(make('touchend', at))
    await new Promise(r => setTimeout(r, 500))
    return { onGrip, before, after: doc.getSelection()?.toString() ?? '' }
  })
  ok(tapped.onGrip, `the press below lands on the grip (${tapped.onGrip})`)
  ok(tapped.after === tapped.before && tapped.after !== '',
    `a long press on a grip does not resize the selection (“${tapped.after}”)`)

  // Drag the end handle onto a later word: the selection grows to reach it.
  const grown = await scanPage.evaluate(async () => {
    const view = window.reader.view
    const doc = view.renderer.getContents().find(c => c.doc?.querySelector('#canvas > canvas')).doc
    const canvas = doc.querySelector('#canvas > canvas')
    const box = canvas.getBoundingClientRect()
    const word = doc.querySelector('.textLayer span[data-ocr-word="4"]').getBoundingClientRect()
    const endHandle = doc.querySelector('.anx-handles .anx-handle[data-anx-handle="end"]')
    const h = endHandle.getBoundingClientRect()
    const from = { x: h.left + h.width / 2, y: h.top + h.height / 2 }
    const to = { x: box.x + word.x + word.width / 2, y: box.y + word.y + word.height / 2 }
    const startPage = view.renderer.index
    const el = doc.elementFromPoint(from.x, from.y) ?? canvas
    const make = (type, p) => {
      const touch = new doc.defaultView.Touch({ identifier: 1, target: el,
        clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y,
        pageX: p.x, pageY: p.y, radiusX: 10, radiusY: 10, force: 1 })
      return new doc.defaultView.TouchEvent(type, { bubbles: true, cancelable: true,
        composed: true, touches: type === 'touchend' ? [] : [touch],
        targetTouches: type === 'touchend' ? [] : [touch], changedTouches: [touch] })
    }
    el.dispatchEvent(make('touchstart', from))
    for (let i = 1; i <= 6; i++) {
      el.dispatchEvent(make('touchmove', {
        x: from.x + (to.x - from.x) * i / 6, y: from.y + (to.y - from.y) * i / 6 }))
      await new Promise(r => setTimeout(r, 60))
    }
    el.dispatchEvent(make('touchend', to))
    await new Promise(r => setTimeout(r, 700))
    return { startPage, endPage: view.renderer.index,
      selection: doc.getSelection()?.toString?.() ?? '',
      payload: window.__calls?.filter(c => c.name === 'onSelectionEnd').pop()?.data?.text ?? null }
  })
  // Each word is its own span, so a range across two words reads as the two run
  // together: the spaces between them are ML Kit's, not in the page.
  const acrossWasBeginning = ['was', 'beginning'].join('')
  ok(grown.selection === acrossWasBeginning, `the end handle extends the selection (“${grown.selection}”)`)
  ok(grown.payload === acrossWasBeginning, `and the app is told the new range (“${grown.payload}”)`)
  ok(grown.endPage === grown.startPage,
    `dragging a handle does not turn the page (${grown.startPage} → ${grown.endPage})`)

  // Dragged back over the first word again, the range shrinks to it.
  const shrunk = await scanPage.evaluate(async () => {
    const view = window.reader.view
    const doc = view.renderer.getContents().find(c => c.doc?.querySelector('#canvas > canvas')).doc
    const canvas = doc.querySelector('#canvas > canvas')
    const box = canvas.getBoundingClientRect()
    const targetWord = doc.querySelector('.textLayer span[data-ocr-word="3"]')
    const word = targetWord.getBoundingClientRect()
    const endHandle = doc.querySelector('.anx-handles .anx-handle[data-anx-handle="end"]')
    const h = endHandle.getBoundingClientRect()
    const from = { x: h.left + h.width / 2, y: h.top + h.height / 2 }
    const to = { x: box.x + word.x + word.width / 2, y: box.y + word.y + word.height / 2 }
    const el = doc.elementFromPoint(from.x, from.y) ?? canvas
    const make = (type, p) => {
      const touch = new doc.defaultView.Touch({ identifier: 1, target: el,
        clientX: p.x, clientY: p.y, screenX: p.x, screenY: p.y,
        pageX: p.x, pageY: p.y, radiusX: 10, radiusY: 10, force: 1 })
      return new doc.defaultView.TouchEvent(type, { bubbles: true, cancelable: true,
        composed: true, touches: type === 'touchend' ? [] : [touch],
        targetTouches: type === 'touchend' ? [] : [touch], changedTouches: [touch] })
    }
    el.dispatchEvent(make('touchstart', from))
    for (let i = 1; i <= 6; i++) {
      el.dispatchEvent(make('touchmove', {
        x: from.x + (to.x - from.x) * i / 6, y: from.y + (to.y - from.y) * i / 6 }))
      await new Promise(r => setTimeout(r, 60))
    }
    el.dispatchEvent(make('touchend', to))
    await new Promise(r => setTimeout(r, 700))
    return doc.getSelection()?.toString?.() ?? ''
  })
  ok(shrunk === 'was', `and dragged back it shrinks again (“${shrunk}”)`)

  // A press that is not on a handle is an ordinary press: it selects the word
  // under the finger even while the last selection's handles are still up.
  await pressAt(0.15, 0.609)          // 'Alice'
  await scanPage.waitForTimeout(1200)
  const afterHandles = await scanPage.evaluate(() => {
    const renderer = window.reader.view.renderer
    const doc = (renderer.getContents().find(c => c.index === renderer.index)
      ?? renderer.getContents()[0]).doc
    return doc.getSelection()?.toString?.() ?? ''
  })
  ok(afterHandles === 'Alice',
    `a press beside a selection is still a press on a word (“${afterHandles}”)`)

  // A page whose OCR yields nothing must say so instead of failing silently.
  await scanPage.evaluate(() => {
    window.__ocrAnswer = { ok: false, reason: 'no text found' }
  })
  const second = await scanPage.evaluate(async () => {
    window.changeStyle({ pdfZoomMode: 'fit-page', pdfZoomLevel: 100 })
    window.nextPage()
    await new Promise(resolve => setTimeout(resolve, 2000))
    return window.reader.view.renderer.index
  })
  await pressAt(0.25, 0.20)
  await scanPage.waitForTimeout(1500)
  const unavailable = await lastCall(scanPage, 'ocrUnavailable')
  ok(second > 0, `the press was made on another page (${second})`)
  ok(!!unavailable, 'a page the OCR could not read reports it to the app')
  ok(unavailable?.page === second, `naming the page (${unavailable?.page})`)
  await scanPage.close()

  // -------------------------------------------------------------------------
  console.log('\n[14] a recognised page keeps its words for the next session')
  // A second reader session — a fresh page, so nothing is in memory — answers
  // `ocrCached` with what the first one saved, the way the app does from its
  // per-book store. The page must come back with its text, and a highlight made
  // on a recognised word must draw itself without anyone pressing first.
  const reopenPage = await context.newPage()
  reopenPage.on('pageerror', e => errors.push(`reopen: ${String(e)}`))
  await reopenPage.bringToFront()
  await reopenPage.addInitScript((stored) => {
    window.__ocrRequests = 0
    const original = window.flutter_inappwebview.callHandler
    window.flutter_inappwebview.callHandler = (name, data) => {
      if (name === 'ocrPage') window.__ocrRequests++
      if (name === 'ocrCached') return Promise.resolve({ words: stored[data?.page] ?? null })
      if (name === 'ocrSave') { stored[data?.page] = data?.words; return Promise.resolve(null) }
      return original(name, data)
    }
  }, { 0: saved?.words ?? [] })
  await reopenPage.goto(readerUrl({ file: SCAN_PDF }))
  await reopenPage.waitForFunction(() => window.reader?.view?.isFixedLayout === true, { timeout: 60000 })
  await reopenPage.waitForFunction(() => {
    const doc = window.reader?.view?.renderer?.getContents?.()
      .find(c => c.doc?.querySelector('#canvas > canvas'))?.doc
    return doc?.querySelectorAll('.textLayer span[data-ocr-word]').length > 0
  }, { timeout: 60000 }).catch(() => {})

  const reopened = await reopenPage.evaluate(() => {
    const renderer = window.reader.view.renderer
    const doc = (renderer.getContents().find(c => c.index === renderer.index)
      ?? renderer.getContents()[0]).doc
    const spans = Array.from(doc.querySelectorAll('.textLayer span[data-ocr-word]'))
    const astral = spans.find(s => s.dataset.ocrWord === '2')?.textContent ?? null
    const frame = doc.defaultView.frameElement.getBoundingClientRect()
    const span = spans[0]?.getBoundingClientRect?.() ?? null
    return {
      requests: window.__ocrRequests,
      spans: spans.length,
      first: spans[0]?.textContent ?? null,
      width: span?.width ?? 0,
      onScreen: span ? { x: frame.left + span.left, y: frame.top + span.top } : null,
      astral,
    }
  })
  ok(reopened.requests === 0,
    `the words came from the app, not another OCR run (${reopened.requests} requests)`)
  ok(reopened.spans === words.length, `the page opens with its text back (${reopened.spans} spans)`)
  ok(reopened.first === words[0].text, `the same words (“${reopened.first}”)`)
  ok(Math.abs(reopened.width - ocr.firstBox.width) < 2,
    `in the same place (${ocr.firstBox.width.toFixed(1)} → ${reopened.width.toFixed(1)}px)`)
  ok(reopened.astral === ASTRAL_WORD,
    'the Unicode 17 ideographs come back whole from the app store too')
  await reopenPage.screenshot({ path: join(SHOTS, '14-ocr-restored.png') })

  // The annotation is added before the restore can have landed (the words come
  // back over the bridge), so this is the ordering the reader actually hits.
  const annotated = await reopenPage.evaluate(async (cfi) => {
    const view = window.reader.view
    // What the app does on a page it re-opens: hand the highlight over as soon
    // as the page is there, which can be before the words have come back.
    window.addAnnotation({ value: cfi, type: 'highlight', color: '#ffcc00' })
    await new Promise(resolve => setTimeout(resolve, 2500))
    const contents = view.renderer.getContents()
    const shape = contents.map(c => c.overlayer?.element?.querySelector('g[fill]')).find(Boolean)
    const box = shape?.getBoundingClientRect?.() ?? null
    return {
      drawn: !!shape,
      w: box?.width ?? 0,
      h: box?.height ?? 0,
      contents: contents.map(c => ({
        index: c.index,
        overlayer: !!c.overlayer,
        groups: c.overlayer?.element?.querySelectorAll('g').length ?? 0,
      })),
      annotations: window.reader.annotations?.size ?? null,
    }
  }, ocrPayload?.cfi)
  ok(annotated.drawn && annotated.w > 0 && annotated.h > 0,
    `a highlight on a recognised word draws after the restore (${annotated.w.toFixed(0)}×${annotated.h.toFixed(0)}px)`,
    JSON.stringify(annotated))
  await reopenPage.screenshot({ path: join(SHOTS, '14-ocr-highlight.png') })
  await reopenPage.close()

  // -------------------------------------------------------------------------
  console.log('\n[15] the page reported no errors')
  const realErrors = errors.filter(e => !/favicon|Download the React/i.test(e))
  ok(realErrors.length === 0, 'no console/page errors', realErrors.slice(0, 3).join(' | '))

  await browser.close()
  console.log(`\n${failures ? 'FAILED' : 'PASSED'}: ${checks - failures}/${checks} checks`)
  console.log(`screenshots in ${SHOTS}`)
  process.exit(failures ? 1 : 0)
}

run().catch(e => {
  console.error('harness error:', e)
  process.exit(2)
})
