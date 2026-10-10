import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:eduplus/theme.dart';
import 'package:eduplus/widgets.dart';

/// These cover the parts of the student app that carry a promise:
/// that a level always shows its written label, that "insufficient data" is
/// never dressed up as a level, and that progress is countable.
///
/// They deliberately avoid Firebase — the data layer is covered by the
/// Firestore rules tests, which exercise the real security boundary.
void main() {
  testWidgets('a level pill always shows its written label', (tester) async {
    for (final entry in levelLabels.entries) {
      await tester.pumpWidget(
        MaterialApp(home: Scaffold(body: LevelPill(level: entry.key))),
      );
      expect(
        find.text(entry.value),
        findsOneWidget,
        reason: 'colour must never be the only signal for ${entry.key}',
      );
    }
  });

  testWidgets('insufficient data replaces the level rather than colouring it', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: LevelPill(level: 'critical', insufficientData: true)),
      ),
    );

    expect(find.text('Insufficient data'), findsOneWidget);
    // A student we know nothing about must not be shown as Critical.
    expect(find.text('Critical'), findsNothing);
  });

  test('the insufficient-data palette is not on the green-to-red scale', () {
    for (final level in levelLabels.keys) {
      expect(EduColors.noDataFill, isNot(equals(EduColors.fillFor(level))));
      expect(EduColors.noDataText, isNot(equals(EduColors.textFor(level))));
    }
  });

  testWidgets('segmented progress renders one segment per task', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: SegmentedProgress(done: 2, total: 5)),
      ),
    );

    expect(find.byType(Expanded), findsNWidgets(5));
  });

  testWidgets('an attendance ring with no data shows a dash, not zero', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(body: AttendanceRing(percent: null, color: EduColors.ink)),
      ),
    );

    // No data and 0% mean opposite things; the ring must not claim the latter.
    expect(find.text('—'), findsOneWidget);
    expect(find.text('0%'), findsNothing);
  });

  testWidgets('an empty state says what happens next', (tester) async {
    await tester.pumpWidget(
      const MaterialApp(
        home: Scaffold(
          body: EduEmpty(title: 'No tasks right now', body: 'They appear here when agreed.'),
        ),
      ),
    );

    expect(find.text('No tasks right now'), findsOneWidget);
    expect(find.text('They appear here when agreed.'), findsOneWidget);
  });

  test('every level has a gradient, so the card feel matches the label', () {
    for (final level in levelLabels.keys) {
      expect(EduColors.gradientFor(level).length, 2);
    }
  });

  // ── Meetings ──────────────────────────────────────────────────────────────

  Map<String, dynamic> meeting({
    required DateTime startsAt,
    Duration length = const Duration(minutes: 30),
    String status = 'scheduled',
    String? joinUrl = 'https://meet.jit.si/EduPlus-abc-123',
  }) => {
        'meetingId': 'mt1',
        'title': 'Catch-up with your mentor',
        'agenda': 'A short catch-up about how the term is going.',
        'startsAt': startsAt.toIso8601String(),
        'endsAt': startsAt.add(length).toIso8601String(),
        'status': status,
        'joinUrl': joinUrl,
      };

  Future<void> pumpMeeting(WidgetTester tester, Map<String, dynamic> m) =>
      tester.pumpWidget(MaterialApp(home: Scaffold(body: MeetingTile(meeting: m))));

  testWidgets('a meeting about to start can be joined', (tester) async {
    await pumpMeeting(
      tester,
      meeting(startsAt: DateTime.now().add(const Duration(minutes: 5))),
    );

    final button = tester.widget<FilledButton>(find.byType(FilledButton));
    expect(button.onPressed, isNotNull, reason: 'the join button should be live');
    expect(find.text('Catch-up with your mentor'), findsOneWidget);
  });

  testWidgets('a meeting tomorrow shows the link but does not let you in yet', (tester) async {
    await pumpMeeting(
      tester,
      meeting(startsAt: DateTime.now().add(const Duration(days: 1))),
    );

    final button = tester.widget<FilledButton>(find.byType(FilledButton));
    expect(button.onPressed, isNull);
  });

  testWidgets('a finished meeting is no longer joinable', (tester) async {
    await pumpMeeting(
      tester,
      meeting(startsAt: DateTime.now().subtract(const Duration(hours: 2))),
    );

    final button = tester.widget<FilledButton>(find.byType(FilledButton));
    expect(button.onPressed, isNull);
  });

  testWidgets('a cancelled meeting says so and offers no way in', (tester) async {
    // A student who was expecting a meeting needs to see it was called off,
    // which is why cancelled meetings stay on the calendar rather than vanish.
    await pumpMeeting(
      tester,
      meeting(
        startsAt: DateTime.now().add(const Duration(minutes: 5)),
        status: 'cancelled',
        joinUrl: null,
      ),
    );

    expect(find.text('Cancelled by your mentor'), findsOneWidget);
    expect(find.byType(FilledButton), findsNothing);
  });
}
