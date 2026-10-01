import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:anx_reader/utils/get_path/get_base_path.dart';
import 'package:anx_reader/utils/log/common.dart';

/// The words OCR found on a book's pages, kept next to the book so a scanned
/// page still carries its text when the book is opened again — a highlight made
/// on a recognised word has to be drawn again on the next session.
///
/// One JSON file per book, `ocr/<bookId>.json`, holding `{"<page>": [words]}`.
/// That is small enough to rewrite whole: a page of prose is a few tens of
/// words, and only pages that were actually recognised are in it.
class OcrStore {
  /// Per-book cache, so a page restore does not re-read the file each time.
  static final Map<int, Map<String, dynamic>> _cache = {};

  /// Writes are chained: two pages recognised in quick succession must not
  /// read-modify-write over each other.
  static Future<void> _writes = Future.value();

  static File _file(int bookId) => File(getBasePath('ocr/$bookId.json'));

  static Future<Map<String, dynamic>> _load(int bookId) async {
    final cached = _cache[bookId];
    if (cached != null) return cached;
    Map<String, dynamic> all = {};
    try {
      final file = _file(bookId);
      if (file.existsSync()) {
        final decoded = jsonDecode(await file.readAsString());
        if (decoded is Map) all = decoded.cast<String, dynamic>();
      }
    } catch (e) {
      AnxLog.warning('OCR cache for book $bookId is unreadable: $e');
    }
    _cache[bookId] = all;
    return all;
  }

  /// The words kept for [page], or null when that page was never recognised.
  static Future<List<dynamic>?> loadPage(int bookId, int page) async {
    final all = await _load(bookId);
    final words = all['$page'];
    if (words is List && words.isNotEmpty) return words;
    return null;
  }

  /// Keep [words] (boxes as fractions of the page) for [page].
  static Future<void> savePage(
      int bookId, int page, List<dynamic> words) async {
    if (words.isEmpty) return;
    final all = await _load(bookId);
    all['$page'] = words;
    final waiting = _writes;
    final done = Completer<void>();
    _writes = done.future;
    try {
      await waiting;
      final file = _file(bookId);
      await file.parent.create(recursive: true);
      await file.writeAsString(jsonEncode(all), flush: true);
    } catch (e) {
      AnxLog.warning('Failed to store the OCR words of book $bookId: $e');
    } finally {
      done.complete();
    }
  }

  /// Forget a book's cache (the file goes with the book).
  static void forget(int bookId) {
    _cache.remove(bookId);
    try {
      final file = _file(bookId);
      if (file.existsSync()) file.deleteSync();
    } catch (_) {}
  }
}
