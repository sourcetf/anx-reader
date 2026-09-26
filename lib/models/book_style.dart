import 'dart:convert';

class BookStyle {
  double fontSize;
  String fontFamily;
  double fontWeight;
  double lineHeight;
  double letterSpacing;
  double wordSpacing;
  double paragraphSpacing;
  double sideMargin;
  double topMargin;
  double bottomMargin;
  double indent;
  int maxColumnCount;
  double headingFontSize;
  double columnThreshold;

  // Fixed-layout (PDF) page settings
  /// 'fit-page', 'fit-width' or 'original-size'
  String pdfZoomMode;
  /// Percent, 50..500
  int pdfZoomLevel;
  /// Show two pages side by side when the viewport allows it
  bool pdfSpread;
  /// Percent, 50..300
  int pdfContrast;
  /// Keep the page from moving sideways while panning vertically
  bool pdfLockPan;
  /// Recolour the page bitmap to follow the reading theme
  bool pdfApplyTheme;

  BookStyle({
    this.fontSize = 1.4,
    this.fontFamily = 'Arial',
    this.fontWeight = 400,
    this.lineHeight = 1.8,
    this.letterSpacing = 0.0,
    this.wordSpacing = 0.0,
    this.paragraphSpacing = 1.0,
    this.sideMargin = 6.0,
    this.topMargin = 90.0,
    this.bottomMargin = 50.0,
    this.indent = 0,
    this.maxColumnCount = 0,
    this.headingFontSize = 1.0,
    this.columnThreshold = 720.0,
    this.pdfZoomMode = 'fit-page',
    this.pdfZoomLevel = 100,
    this.pdfSpread = true,
    this.pdfContrast = 100,
    this.pdfLockPan = false,
    this.pdfApplyTheme = false,
  });

  BookStyle copyWith({
    double? fontSize,
    String? fontFamily,
    double? fontWeight,
    double? lineHeight,
    double? letterSpacing,
    double? wordSpacing,
    double? paragraphSpacing,
    double? sideMargin,
    double? topMargin,
    double? bottomMargin,
    double? indent,
    int? maxColumnCount,
    double? headingFontSize,
    double? columnThreshold,
    String? pdfZoomMode,
    int? pdfZoomLevel,
    bool? pdfSpread,
    int? pdfContrast,
    bool? pdfLockPan,
    bool? pdfApplyTheme,
  }) {
    return BookStyle(
      fontSize: fontSize ?? this.fontSize,
      fontFamily: fontFamily ?? this.fontFamily,
      fontWeight: fontWeight ?? this.fontWeight,
      lineHeight: lineHeight ?? this.lineHeight,
      letterSpacing: letterSpacing ?? this.letterSpacing,
      wordSpacing: wordSpacing ?? this.wordSpacing,
      paragraphSpacing: paragraphSpacing ?? this.paragraphSpacing,
      sideMargin: sideMargin ?? this.sideMargin,
      topMargin: topMargin ?? this.topMargin,
      bottomMargin: bottomMargin ?? this.bottomMargin,
      indent: indent ?? this.indent,
      maxColumnCount: maxColumnCount ?? this.maxColumnCount,
      headingFontSize: headingFontSize ?? this.headingFontSize,
      columnThreshold: columnThreshold ?? this.columnThreshold,
      pdfZoomMode: pdfZoomMode ?? this.pdfZoomMode,
      pdfZoomLevel: pdfZoomLevel ?? this.pdfZoomLevel,
      pdfSpread: pdfSpread ?? this.pdfSpread,
      pdfContrast: pdfContrast ?? this.pdfContrast,
      pdfLockPan: pdfLockPan ?? this.pdfLockPan,
      pdfApplyTheme: pdfApplyTheme ?? this.pdfApplyTheme,
    );
  }

  Map<String, Object> toMap() {
    return {
      'fontSize': fontSize,
      'fontFamily': fontFamily,
      'fontWeight': fontWeight,
      'lineHeight': lineHeight,
      'letterSpacing': letterSpacing,
      'wordSpacing': wordSpacing,
      'paragraphSpacing': paragraphSpacing,
      'sideMargin': sideMargin,
      'topMargin': topMargin,
      'bottomMargin': bottomMargin,
      'indent': indent,
      'maxColumnCount': maxColumnCount,
      'headingFontSize': headingFontSize,
      'columnThreshold': columnThreshold,
      'pdfZoomMode': pdfZoomMode,
      'pdfZoomLevel': pdfZoomLevel,
      'pdfSpread': pdfSpread,
      'pdfContrast': pdfContrast,
      'pdfLockPan': pdfLockPan,
      'pdfApplyTheme': pdfApplyTheme,
    };
  }

  String toJson() {
    return '''
    {
      "fontSize": $fontSize,
      "fontFamily": "$fontFamily",
      "fontWeight": $fontWeight,
      "lineHeight": $lineHeight,
      "letterSpacing": $letterSpacing,
      "wordSpacing": $wordSpacing,
      "paragraphSpacing": $paragraphSpacing,
      "sideMargin": $sideMargin,
      "topMargin": $topMargin,
      "bottomMargin": $bottomMargin,
      "indent": $indent,
      "maxColumnCount": $maxColumnCount,
      "headingFontSize": $headingFontSize,
      "columnThreshold": $columnThreshold,
      "pdfZoomMode": "$pdfZoomMode",
      "pdfZoomLevel": $pdfZoomLevel,
      "pdfSpread": $pdfSpread,
      "pdfContrast": $pdfContrast,
      "pdfLockPan": $pdfLockPan,
      "pdfApplyTheme": $pdfApplyTheme
    }
    ''';
  }

  factory BookStyle.fromJson(String json) {
    Map<String, dynamic> data = jsonDecode(json);
    double fontsSize = data['fontSize'] is String
        ? double.parse(data['fontSize'])
        : data['fontSize'];
    double paragraphSpacing = data['paragraphSpacing'] is String
        ? double.parse(data['paragraphSpacing'])
        : data['paragraphSpacing'];
    double fontWeight = data['fontWeight'] == null
        ? 400
        : data['fontWeight'] is String
            ? double.parse(data['fontWeight'])
            : data['fontWeight'];

    if (fontsSize > 3 || fontsSize < 0.5) {
      fontsSize = 1.4;
    }
    if (paragraphSpacing > 3 || paragraphSpacing < 0) {
      paragraphSpacing = 1.5;
    }

    return BookStyle(
      fontSize: fontsSize,
      fontFamily: data['fontFamily'],
      fontWeight: fontWeight,
      lineHeight: data['lineHeight'] is String
          ? double.parse(data['lineHeight'])
          : data['lineHeight'],
      letterSpacing: data['letterSpacing'] is String
          ? double.parse(data['letterSpacing'])
          : data['letterSpacing'],
      wordSpacing: data['wordSpacing'] is String
          ? double.parse(data['wordSpacing'])
          : data['wordSpacing'],
      paragraphSpacing: paragraphSpacing,
      sideMargin: data['sideMargin'] is String
          ? double.parse(data['sideMargin'])
          : data['sideMargin'],
      topMargin: data['topMargin'] is String
          ? double.parse(data['topMargin'])
          : data['topMargin'],
      bottomMargin: data['bottomMargin'] is String
          ? double.parse(data['bottomMargin'])
          : data['bottomMargin'],
      indent: data['indent'] == null
          ? 0
          : data['indent'] is String
              ? double.parse(data['indent'])
              : data['indent'],
      maxColumnCount: data['maxColumnCount'] == null
          ? 0
          : data['maxColumnCount'] is String
              ? int.parse(data['maxColumnCount'])
              : data['maxColumnCount'],
      headingFontSize: data['headingFontSize'] == null
          ? 1.5
          : data['headingFontSize'] is String
              ? double.parse(data['headingFontSize'])
              : data['headingFontSize'],
      columnThreshold: data['columnThreshold'] == null
          ? 720.0
          : data['columnThreshold'] is String
              ? double.parse(data['columnThreshold'])
              : data['columnThreshold'],
      pdfZoomMode: data['pdfZoomMode'] is String
          ? data['pdfZoomMode']
          : 'fit-page',
      pdfZoomLevel: data['pdfZoomLevel'] == null
          ? 100
          : data['pdfZoomLevel'] is String
              ? int.parse(data['pdfZoomLevel'])
              : data['pdfZoomLevel'],
      pdfSpread: data['pdfSpread'] == null ? true : data['pdfSpread'],
      pdfContrast: data['pdfContrast'] == null
          ? 100
          : data['pdfContrast'] is String
              ? int.parse(data['pdfContrast'])
              : data['pdfContrast'],
      pdfLockPan: data['pdfLockPan'] == null ? false : data['pdfLockPan'],
      pdfApplyTheme:
          data['pdfApplyTheme'] == null ? false : data['pdfApplyTheme'],
    );
  }
}
