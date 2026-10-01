import 'dart:convert';
import 'dart:io';

import 'package:anx_reader/utils/log/common.dart';
import 'package:anx_reader/utils/get_path/get_temp_dir.dart';
import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';

/// On-device OCR for pages that carry no text of their own (scanned PDFs).
///
/// A page bitmap comes over the WebView bridge as a PNG data URL, ML Kit returns
/// the words it found with their boxes, and the caller injects them as the
/// page's text layer — from there the reader's normal selection, highlight,
/// search and narration paths apply, so nothing else has to know about OCR.
class OcrService {
  static final Map<TextRecognitionScript, TextRecognizer> _recognizers = {};

  /// The script to read with, guessed from the book's language code.
  static TextRecognitionScript scriptFor(String? languageCode) {
    final code = (languageCode ?? '').toLowerCase();
    if (code.startsWith('zh')) return TextRecognitionScript.chinese;
    if (code.startsWith('ja')) return TextRecognitionScript.japanese;
    if (code.startsWith('ko')) return TextRecognitionScript.korean;
    return TextRecognitionScript.latin;
  }

  static TextRecognizer _recognizer(TextRecognitionScript script) =>
      _recognizers.putIfAbsent(script, () => TextRecognizer(script: script));

  /// Recognise [dataUrl] (a `data:image/png;base64,...` page bitmap) and return
  /// one entry per word: `{text, x, y, w, h}` with the box in the bitmap's own
  /// pixels, which is the space the caller's canvas is measured in.
  static Future<Map<String, dynamic>> recognize(
    String dataUrl, {
    String? languageCode,
  }) async {
    final commaAt = dataUrl.indexOf(',');
    if (commaAt < 0) {
      return {'ok': false, 'reason': 'not a data url'};
    }
    final bytes = base64Decode(dataUrl.substring(commaAt + 1));
    final dir = await getAnxTempDir();
    final file = File('${dir.path}/anx-ocr-page.png');
    await file.writeAsBytes(bytes, flush: true);

    final script = scriptFor(languageCode);
    try {
      final recognised = await _recognizer(script)
          .processImage(InputImage.fromFilePath(file.path));
      final words = <Map<String, dynamic>>[];
      for (final block in recognised.blocks) {
        for (final line in block.lines) {
          for (final element in line.elements) {
            final text = element.text.trim();
            if (text.isEmpty) continue;
            final box = element.boundingBox;
            words.add({
              'text': text,
              'x': box.left,
              'y': box.top,
              'w': box.width,
              'h': box.height,
            });
          }
        }
      }
      AnxLog.info('OCR (${script.name}): ${words.length} words on the page');
      return {'ok': true, 'words': words};
    } catch (e) {
      // No recogniser on this device (some emulators lack the native libraries):
      // report it so the reader can say so instead of failing silently.
      AnxLog.warning('OCR failed: $e');
      return {'ok': false, 'reason': '$e'};
    } finally {
      if (file.existsSync()) {
        try {
          file.deleteSync();
        } catch (_) {}
      }
    }
  }
}
