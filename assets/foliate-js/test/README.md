# foliate-js port tests

Node + jsdom tests for the PDF / fixed-layout pipeline in `../src`. They cover
the engine side only (no Flutter, no WebView): the PDF book module, the
fixed-layout renderer, the view that wires renderer + overlayer + TTS + search,
and the checked-in legacy build in `../dist`.

```bash
npm install jsdom             # not a dependency of the app
cd assets/foliate-js/test
node unicode.test.mjs         # the Unicode classes and the text cuts (no DOM)
node pdf.test.mjs             # makePDF, pdf-text, per-page CFIs
node fxl.test.mjs             # the fixed-layout renderer (ES modules)
node view.test.mjs            # the whole read path: modules, then dist/bundle.js
node legacy.test.mjs          # dist/bundle.js only
node render.test.mjs          # what render() does to a page document
```

`pdf.test.mjs` needs two sample PDFs. They are not shipped with the app — point
the test at any copy (for example
[readest's fixtures](https://github.com/readest/readest/tree/main/apps/readest-app/src/__tests__/fixtures/data)):

```bash
ANX_PDF_FIXTURES=/path/to/fixtures node pdf.test.mjs
```

`fixtures/sample-alice.pdf` (a text PDF with many pages) and
`fixtures/sample-metadata.pdf` (whose Info title is `PDF Metadata` and author
`Readest`) are the ones the expectations are written against. The browser
suite additionally uses `sample-alice-outline.pdf` (an outline of twelve
entries) and `sample-alice-scan.pdf` (an image-only PDF) — see
`browser/README.md`.

## What the tests stand in for

jsdom has no layout engine, no canvas, no constructable stylesheets, no object
URLs and does not load iframes inside a shadow root, so each file sets up the
minimum those paths need (`CSSStyleSheet`, `ResizeObserver`,
`IntersectionObserver`, frame load events with a page document,
`Range.getClientRects`, `URL.createObjectURL`, `canvas.toBlob`).

`render.test.mjs` draws through a recording 2D context: the *decisions* around
the bitmap (its size, its CSS box, the scale published to the text layer, when a
re-render is skipped) are asserted, but the pixels pdf.js paints are not — that
needs a real engine.
