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
    const doc = window.reader.view.renderer.getContents().find(c => c.doc?.querySelector('#canvas > canvas')).doc
    const canvas = doc.querySelector('#canvas > canvas')
    return { width: canvas.width, cssWidth: parseFloat(canvas.style.width) }
  })
  await page.evaluate(() => window.changeStyle({ pdfZoomMode: 'fit-width', pdfZoomLevel: 200 }))
  await page.waitForTimeout(1200)
  const after = await page.evaluate(() => {
    const doc = window.reader.view.renderer.getContents().find(c => c.doc?.querySelector('#canvas > canvas')).doc
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
  console.log('\n[13] the page reported no errors')
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
