import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:typed_data';
import 'package:anx_reader/utils/get_path/get_base_path.dart';
import 'package:anx_reader/utils/log/common.dart';

Future<String> saveImageToLocal(String? imageFile, String name) async {
  if (imageFile == null) {
    return name;
  }
  // A cover arrives as a base64 data URI. A book without one can hand over an
  // empty string or a plain path instead, which is not an error to report.
  final List<String> parts = imageFile.split(',');
  if (parts.length < 2 || !parts[0].contains('base64')) {
    return name;
  }
  try {
    // data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD//gA8Q1JFQVRPUjogZ2...
    final String base64String = parts[1];
    final Uint8List pngBytes = base64.decode(base64String);
    final extension = parts[0].split('/')[1].split(';')[0];

    name = '$name.$extension';
    final path = getBasePath(name);

    final file = File(path);
    await file.writeAsBytes(pngBytes);

    return name;
  } catch (e) {
    AnxLog.severe('Error saving image\n$e');
    return name;
  }
}
