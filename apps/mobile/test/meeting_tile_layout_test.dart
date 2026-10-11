import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:eduplus/theme.dart';
import 'package:eduplus/widgets.dart';

/// Reproducing the schedule card that rendered one character per line.
///
/// The symptom is a text column that got almost no width, so the assertion is
/// on geometry rather than on content: a title laid out in a normal-width list
/// must be a line or two tall, not twenty.
void main() {
  Map<String, dynamic> meeting({String? joinUrl = 'https://meet.jit.si/EduPlus-abc'}) => {
        'meetingId': 'mt1',
        'title': 'Catch-up with Pavan',
        'agenda': 'A short catch-up about how the term is going.',
        'startsAt': DateTime.now().add(const Duration(minutes: 5)).toIso8601String(),
        'endsAt': DateTime.now().add(const Duration(minutes: 35)).toIso8601String(),
        'status': 'scheduled',
        'joinUrl': joinUrl,
      };

  Future<void> pumpAt(WidgetTester tester, double width, Map<String, dynamic> m) async {
    await tester.pumpWidget(
      MaterialApp(
        // The REAL theme. Without it this test passed while the screen was
        // broken: the theme is what gives every FilledButton an infinite
        // minimum width, and that was the bug.
        theme: buildTheme(),
        home: Scaffold(
          body: Center(
            child: SizedBox(
              width: width,
              child: MeetingTile(meeting: m),
            ),
          ),
        ),
      ),
    );
  }

  testWidgets('the title gets real width at a phone size', (tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.75;
    addTearDown(tester.view.reset);

    await pumpAt(tester, 360, meeting());

    final titleSize = tester.getSize(find.text('Catch-up with Pavan'));
    // One character per line put this at roughly 20 lines. Two lines of 15px
    // text is about 40 logical pixels, so 80 is a generous ceiling that still
    // catches the failure by a mile.
    expect(titleSize.height, lessThan(80),
        reason: 'title is ${titleSize.height}px tall — it is wrapping per character');
    expect(titleSize.width, greaterThan(100),
        reason: 'title got only ${titleSize.width}px of width');
  });

  testWidgets('the whole tile stays a sensible height', (tester) async {
    await pumpAt(tester, 360, meeting());

    final tileSize = tester.getSize(find.byType(MeetingTile));
    expect(tileSize.height, lessThan(220),
        reason: 'tile is ${tileSize.height}px tall');
  });

  testWidgets('still lays out when there is no join button', (tester) async {
    await pumpAt(tester, 360, meeting(joinUrl: null));

    final titleSize = tester.getSize(find.text('Catch-up with Pavan'));
    expect(titleSize.height, lessThan(80));
  });

  testWidgets('survives a narrow phone', (tester) async {
    // 320 logical is the narrowest Android worth supporting.
    await pumpAt(tester, 320, meeting());

    final titleSize = tester.getSize(find.text('Catch-up with Pavan'));
    expect(titleSize.height, lessThan(100));
    expect(tester.takeException(), isNull);
  });
}
