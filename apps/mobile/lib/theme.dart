import 'package:flutter/material.dart';

/// Design tokens for the student app.
///
/// Mirrors `docs/design/DESIGN.md` and `packages/core/src/design/tokens.ts`.
/// The student app is deliberately softer than the faculty dashboard — white
/// cards on pastel gradients, roomier spacing, friendlier numbers — but a risk
/// level must read identically in both, so the level palette is copied exactly
/// rather than reinterpreted.
class EduColors {
  const EduColors._();

  static const canvas = Color(0xFFF7F6F3);
  static const surface = Color(0xFFFFFFFF);
  static const sunk = Color(0xFFEAE7E0);

  static const ink = Color(0xFF121110);
  static const inkMuted = Color(0xFF5C5852);
  static const inkFaint = Color(0xFF8F8A82);
  static const hairline = Color(0xFFDDD9D1);

  static const lime = Color(0xFFD9F99D);

  /// Risk levels. Text colour then fill — every pair clears 7:1.
  static const levelText = <String, Color>{
    'stable': Color(0xFF195936),
    'watch': Color(0xFF704900),
    'at_risk': Color(0xFF7C380E),
    'critical': Color(0xFF8D1A1A),
  };

  static const levelFill = <String, Color>{
    'stable': Color(0xFFDCF2E4),
    'watch': Color(0xFFFBF0D2),
    'at_risk': Color(0xFFFBE3D2),
    'critical': Color(0xFFFBDAD9),
  };

  /// A fifth state, NOT a level. Slate, so it cannot be mistaken for a
  /// position on the green-to-red scale.
  static const noDataText = Color(0xFF484866);
  static const noDataFill = Color(0xFFE6E6F0);

  /// Gradients keyed by level, so the card's feel matches its label.
  static const levelGradient = <String, List<Color>>{
    'stable': [Color(0xFFDFF5EA), Color(0xFFCFE9F7)],
    'watch': [Color(0xFFDCEBFA), Color(0xFFE6F4F1)],
    'at_risk': [Color(0xFFE8E2F7), Color(0xFFF3E4F0)],
    'critical': [Color(0xFFF3E4F0), Color(0xFFFBE3D2)],
  };

  static Color textFor(String level, {bool insufficientData = false}) =>
      insufficientData ? noDataText : (levelText[level] ?? inkMuted);

  static Color fillFor(String level, {bool insufficientData = false}) =>
      insufficientData ? noDataFill : (levelFill[level] ?? sunk);

  static List<Color> gradientFor(String level, {bool insufficientData = false}) =>
      insufficientData
          ? const [Color(0xFFE6E6F0), Color(0xFFEFEFF6)]
          : (levelGradient[level] ?? const [Color(0xFFDFF5EA), Color(0xFFCFE9F7)]);
}

/// Written labels. Colour is never the only signal.
const levelLabels = <String, String>{
  'stable': 'Stable',
  'watch': 'Watch',
  'at_risk': 'At Risk',
  'critical': 'Critical',
};

String labelFor(String level, {bool insufficientData = false}) =>
    insufficientData ? 'Insufficient data' : (levelLabels[level] ?? level);

class EduRadius {
  const EduRadius._();
  static const control = 12.0;
  static const card = 24.0;
  static const hero = 32.0;
  static const pill = 999.0;
}

ThemeData buildTheme() {
  const seed = EduColors.ink;

  final base = ThemeData(
    useMaterial3: true,
    colorScheme: ColorScheme.fromSeed(
      seedColor: seed,
      brightness: Brightness.light,
      surface: EduColors.surface,
    ),
    scaffoldBackgroundColor: EduColors.canvas,
    fontFamily: 'Roboto',
  );

  return base.copyWith(
    textTheme: base.textTheme.apply(
      bodyColor: EduColors.ink,
      displayColor: EduColors.ink,
    ),
    appBarTheme: const AppBarTheme(
      backgroundColor: EduColors.canvas,
      surfaceTintColor: Colors.transparent,
      elevation: 0,
      centerTitle: false,
      titleTextStyle: TextStyle(
        color: EduColors.ink,
        fontSize: 22,
        fontWeight: FontWeight.w600,
        letterSpacing: -0.2,
      ),
    ),
    cardTheme: CardThemeData(
      color: EduColors.surface,
      elevation: 0,
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(EduRadius.card),
        side: const BorderSide(color: EduColors.hairline),
      ),
      margin: EdgeInsets.zero,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        backgroundColor: EduColors.ink,
        foregroundColor: EduColors.canvas,
        // Size.fromHeight is Size(double.infinity, 48) — a full-width button,
        // which is what almost every button in this app wants.
        //
        // CAREFUL: a FilledButton placed in a Row inherits that infinite width,
        // takes the whole row, and leaves any sibling Expanded with zero. The
        // symptom is text wrapping one character per line, which looks nothing
        // like a button problem. An inline button must override minimumSize —
        // see MeetingTile.
        minimumSize: const Size.fromHeight(48),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(EduRadius.control),
        ),
        textStyle: const TextStyle(fontSize: 15, fontWeight: FontWeight.w600),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: EduColors.surface,
      contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(EduRadius.control),
        borderSide: const BorderSide(color: EduColors.hairline),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(EduRadius.control),
        borderSide: const BorderSide(color: EduColors.hairline),
      ),
      focusedBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(EduRadius.control),
        borderSide: const BorderSide(color: EduColors.ink, width: 1.6),
      ),
      labelStyle: const TextStyle(color: EduColors.inkMuted, fontSize: 14),
    ),
  );
}

/// Text styles, named after the type scale in DESIGN.md.
class EduText {
  const EduText._();

  static const display = TextStyle(
    fontSize: 52,
    height: 1.0,
    fontWeight: FontWeight.w700,
    letterSpacing: -1.6,
  );
  static const metric = TextStyle(
    fontSize: 30,
    height: 1.1,
    fontWeight: FontWeight.w700,
    letterSpacing: -0.6,
  );
  static const h1 = TextStyle(fontSize: 24, height: 1.25, fontWeight: FontWeight.w600);
  static const h2 = TextStyle(fontSize: 17, height: 1.35, fontWeight: FontWeight.w600);
  static const body = TextStyle(fontSize: 15, height: 1.5);
  static const bodySm = TextStyle(fontSize: 13.5, height: 1.45, color: EduColors.inkMuted);
  static const label = TextStyle(
    fontSize: 12.5,
    height: 1.3,
    fontWeight: FontWeight.w600,
    color: EduColors.inkMuted,
  );
}
