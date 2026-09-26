This folder forked from [Foliate-js](https://github.com/johnfactotum/foliate-js) which is MIT licensed.
Some changes also come from [readest/foliate-js](https://github.com/readest/foliate-js) which is MIT licensed.

# PDF pipeline

PDF (and every other pre-paginated book) is rendered by `src/fixed-layout.js`
into one iframe per page, with the page bitmap, a selectable text layer and the
PDF's link annotations; `src/pdf.js` builds the book from pdf.js and hands the
renderer a document per page through `onZoom`, so a page is re-rendered crisply
at the scale it is shown at. Page-level CFIs (`epubcfi(/6/2N)`) are what
positions, bookmarks and highlights are stored under, and the text layer makes
search, TTS, copy/translate and highlight rectangles work like they do on an
EPUB.

Notable pieces, all ported from readest's fork unless noted:

- `pdf.js` — range-streamed loading (bounded concurrency), metadata from Info +
  XMP, outline with page indices, page labels (`book.pageList`), RTL from
  ViewerPreferences, per-page documents for search/TTS, `destroy()` so the
  pdf.js worker is released; page bitmap rasterisation clamped for mobile
  WebViews, and a guard that skips re-renders which would tear down the text
  layer TTS is reading from.
- `fixed-layout.js` — zoom modes, single/spread layouts (LTR and RTL), a
  continuous scroll flow with a bounded page-load scheduler, horizontal pan
  lock, page colours (`renderer.pageColors`, how a PDF follows the reader
  theme), pinch zoom, prerendered neighbouring spreads, per-page overlayers.
- `pdf-text.js` — reassembles paragraphs out of a pdf.js text layer (the layer
  only knows printed lines) for copied/translated/annotated text.
- `overlayer.js`, `search.js`, `tts.js`, `progress.js`, `epubcfi.js`,
  `text-walker.js`, `view.js`, `paginator.js` — the supporting changes those
  need: per-page overlayer rectangles, search excerpts that span text nodes,
  TTS over a text layer, progress/`PageProgress`, null-safe CFI resolution.

`src/vendor/pdfjs/` is the pdf.js runtime the app ships (3.11.174, loaded as a
classic script by `index.html`); `vendor/pdfjs/{cmaps,standard_fonts}` are its
CJK CMaps and standard fonts, which the page loads through the local asset
server.

Flutter drives all of this through `assets/foliate-js/index.html`; the app-level
glue and the PDF view settings live in `src/book.js` (`pdf*` keys of the style
object) and on the Dart side in `lib/models/book_style.dart` +
`lib/widgets/reading_page/style_widget.dart`.

`dist/` is a build of `src/` for old Android WebViews (`index.html` picks it
when the engine is not Apple and older than Chrome 100). It is checked in, so
**rebuild it after changing anything under `src/`**:

```bash
cd assets/foliate-js && npm install && npm run build
```

Tests for the pipeline (Node + jsdom) live in `test/`; see `test/README.md`.
