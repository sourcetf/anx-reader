import 'package:anx_reader/service/ocr/ocr_service.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:google_mlkit_text_recognition/google_mlkit_text_recognition.dart';

void main() {
  group('OcrService.scriptFor', () {
    test('reads the script off the book language', () {
      expect(OcrService.scriptFor('zh'), TextRecognitionScript.chinese);
      expect(OcrService.scriptFor('zh-Hans'), TextRecognitionScript.chinese);
      expect(OcrService.scriptFor('ja'), TextRecognitionScript.japanese);
      expect(OcrService.scriptFor('ko'), TextRecognitionScript.korean);
      expect(OcrService.scriptFor('en-US'), TextRecognitionScript.latin);
      expect(OcrService.scriptFor('fr'), TextRecognitionScript.latin);
    });

    test('falls back to latin when the book has no language', () {
      expect(OcrService.scriptFor(null), TextRecognitionScript.latin);
      expect(OcrService.scriptFor(''), TextRecognitionScript.latin);
    });

    test('is not confused by case or region suffixes', () {
      expect(OcrService.scriptFor('ZH-Hant-TW'), TextRecognitionScript.chinese);
      expect(OcrService.scriptFor('JA'), TextRecognitionScript.japanese);
    });
  });
}
