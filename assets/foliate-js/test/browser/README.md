# Real-engine reader test

Drives the actual reader page (`../../index.html` + `../../src/book.js`) in a real
Chromium — the same engine family as Android WebView — with the Flutter bridge
stubbed, and checks what a PDF does end to end: page render, crisp zoom, page
turns, the continuous scroll flow, in-book search, paragraph-joined selection
text, highlights, TTS, bookmarks and the import metadata path. It also writes
screenshots of each step to `shots/`.

```bash
npm install playwright && npx playwright install chromium
node server.mjs 8085 &                        # the app's shelf server, in node
ANX_PDF_FIXTURES=/path/to/fixtures node read.test.mjs 8085
```

`ANX_PDF_FIXTURES` must contain `sample-alice.pdf` (see `../README.md`).

This is the test that catches what jsdom cannot: real layout, real canvas
rasterisation, iframes inside the renderer's shadow root, and the visual result.

## Running it inside a device WebView

The same server can be pointed at any real browser/WebView that can reach it
(an Android emulator reaches the host at `10.0.2.2`):

```bash
node server.mjs 8085 &
adb shell am start -a android.intent.action.VIEW -d \
  "http://10.0.2.2:8085/foliate-js/reader-test.html?importing=false&url=<book url>&initialCfi=%22%22&style=<style json>&readingRules=<rules json>&run=1"
```

`/foliate-js/reader-test.html` serves `index.html` with two extras: the Flutter
bridge is stubbed (so the page runs without the app), and every bridge call plus
a state snapshot is POSTed back to `/__report`, where the server prints it. With
`run=1` the page also drives itself through page turns, zoom, the scroll flow,
search, selection, highlight, TTS and a bookmark, reporting the result of each —
enough to check the pipeline on a device with no app, no adb input and no
devtools: the host terminal shows the run.

Sample run (Android 16 emulator, WebView 133):

```
start               {"index":0,"pages":35,"cfi":"epubcfi(/6/2)","chapter":{"current":1,"total":69},
                     "canvasW":824,"canvasCss":412.19,"spans":51}
after-next-page     {"index":1,"cfi":"epubcfi(/6/4)","chapter":{"current":2,"total":69},"spans":54}
after-zoom          {"canvasW":1236,"canvasCss":618.286,"scale":1.0103}   # re-rasterised, not CSS-scaled
scroll-mode         {"scrolled":true,"slots":69,"loaded":4,
                     "firstPageVisible":{"display":"block","visibility":"visible","h":800}}
back-to-paginated   {"index":1,"pages":35,"scrolled":false}
search              {"results":404,"firstExcerpt":{"pre":"Project Gutenberg's ","match":"Alice"},
                     "firstCfi":"epubcfi(/6/2!/4/4/10,/1:0,/1:5)","done":true,"drawn":[3,7]}
selection           {"text":"By Lewis Carroll\nTHE MILLENNIUM FULCRUM EDITION 3.0", cfi...}
highlight           {"shapes":[1,0]}
tts                 {"sentence":"By Lewis Carroll THE MILLENNIUM FULCRUM EDITION 3.0 Contents", cfi...}
bookmark            {"cfi":"epubcfi(/6/4)","content":""}
```
