import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../data.dart';
import '../theme.dart';
import '../widgets.dart';
import 'activity.dart';
import 'planly.dart';

/// The calendar Planly writes into.
///
/// A day at a time, because a plan that shows four weeks at once is a plan a
/// struggling student closes. Tasks from a mentor's intervention and tasks
/// from Planly sit in the same list — the student does not need to care which
/// is which, only what to do today.
class ScheduleScreen extends StatefulWidget {
  const ScheduleScreen({super.key, required this.data});

  final StudentData data;

  @override
  State<ScheduleScreen> createState() => _ScheduleScreenState();
}

class _ScheduleScreenState extends State<ScheduleScreen> {
  DateTime _selected = DateTime.now();

  String get _selectedKey =>
      '${_selected.year.toString().padLeft(4, '0')}-'
      '${_selected.month.toString().padLeft(2, '0')}-'
      '${_selected.day.toString().padLeft(2, '0')}';

  String get _todayKey {
    final now = DateTime.now();
    return '${now.year.toString().padLeft(4, '0')}-'
        '${now.month.toString().padLeft(2, '0')}-'
        '${now.day.toString().padLeft(2, '0')}';
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: EduColors.canvas,
      appBar: AppBar(
        title: const Text('Schedule'),
        actions: [
          IconButton(
            tooltip: 'Planly',
            icon: const Icon(Icons.auto_awesome_rounded, color: EduColors.inkMuted),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => PlanlyScreen(data: widget.data)),
            ),
          ),
        ],
      ),
      body: Column(
        children: [
          DateStrip(selected: _selected, onSelect: (d) => setState(() => _selected = d)),
          const SizedBox(height: 10),
          Expanded(
            child: StreamBuilder<List<Map<String, dynamic>>>(
              stream: widget.data.meetings(),
              builder: (context, meetingSnap) {
                // Compared in LOCAL time, not by string prefix. `startsAt` is
                // stored in UTC, so a 03:00 IST meeting is 21:30Z the previous
                // day — a prefix match would file it under the wrong date and
                // hide it from the day it actually happens on.
                final meetingsToday = (meetingSnap.data ?? const [])
                    .where((m) {
                      final raw = m['startsAt'];
                      if (raw is! String) return false;
                      final at = DateTime.tryParse(raw)?.toLocal();
                      if (at == null) return false;
                      return at.year == _selected.year &&
                          at.month == _selected.month &&
                          at.day == _selected.day;
                    })
                    .toList();
                return StreamBuilder<List<Map<String, dynamic>>>(
              stream: widget.data.tasks(),
              builder: (context, snap) {
                if (snap.connectionState == ConnectionState.waiting) {
                  return const Center(
                    child: CircularProgressIndicator(color: EduColors.ink),
                  );
                }

                final all = snap.data ?? const [];
                final forDay = all.where((task) {
                  final on = (task['scheduledFor'] ?? task['dueDate']) as String?;
                  return on == _selectedKey;
                }).toList();

                final isToday = _selectedKey == _todayKey;
                final done = forDay.where((t) => t['done'] == true).length;

                return ListView(
                  padding: const EdgeInsets.fromLTRB(20, 4, 20, 110),
                  children: [
                    // A meeting is at a fixed time; the tasks are not. It goes
                    // first so a student planning their day sees the thing
                    // they cannot move.
                    for (final meeting in meetingsToday)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: MeetingTile(meeting: meeting),
                      ),
                    if (forDay.isEmpty && meetingsToday.isEmpty)
                      EduEmpty(
                        title: isToday ? 'Nothing planned for today' : 'Nothing planned',
                        body: all.isEmpty
                            ? 'Ask Planly for a plan and your days fill in automatically.'
                            : 'Pick another day, or ask Planly to add something here.',
                      )
                    else ...[
                      EduCard(
                        title: isToday ? 'Today' : _selectedKey,
                        hint: '$done of ${forDay.length} done',
                        child: SegmentedProgress(done: done, total: forDay.length),
                      ),
                      const SizedBox(height: 14),
                      for (final task in forDay)
                        Padding(
                          padding: const EdgeInsets.only(bottom: 10),
                          child: _ScheduleTile(data: widget.data, task: task),
                        ),
                    ],

                    const SizedBox(height: 10),
                    OutlinedButton.icon(
                      onPressed: () => Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) => PlanlyScreen(data: widget.data),
                        ),
                      ),
                      icon: const Icon(Icons.auto_awesome_rounded, size: 18),
                      label: Text(all.isEmpty ? 'Ask Planly for a plan' : 'Talk to Planly'),
                      style: OutlinedButton.styleFrom(
                        minimumSize: const Size.fromHeight(48),
                        foregroundColor: EduColors.ink,
                        side: const BorderSide(color: EduColors.hairline),
                        shape: RoundedRectangleBorder(
                          borderRadius: BorderRadius.circular(EduRadius.control),
                        ),
                      ),
                    ),
                  ],
                );
              },
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}

const _kindIcons = <String, IconData>{
  'attend': Icons.event_available_rounded,
  'submit': Icons.upload_file_rounded,
  'study': Icons.menu_book_rounded,
  'practice': Icons.fitness_center_rounded,
  'quiz': Icons.quiz_rounded,
  'coding': Icons.terminal_rounded,
  'meet': Icons.people_alt_rounded,
};

class _ScheduleTile extends StatefulWidget {
  const _ScheduleTile({required this.data, required this.task});

  final StudentData data;
  final Map<String, dynamic> task;

  @override
  State<_ScheduleTile> createState() => _ScheduleTileState();
}

class _ScheduleTileState extends State<_ScheduleTile> {
  bool _busy = false;

  Future<void> _toggle(bool next) async {
    setState(() => _busy = true);
    try {
      await widget.data.setTaskDone(widget.task['taskId'] as String, next);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not save that. Check your connection.')),
        );
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final task = widget.task;
    final done = task['done'] == true;
    final kind = (task['kind'] as String?) ?? 'study';
    final minutes = task['minutes'] as int?;
    final activityId = task['activityId'] as String?;
    final fromMentor = task['interventionId'] != null;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: EduColors.surface,
        borderRadius: BorderRadius.circular(EduRadius.card),
        border: Border.all(color: EduColors.hairline),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          GestureDetector(
            onTap: _busy ? null : () => _toggle(!done),
            behavior: HitTestBehavior.opaque,
            child: Container(
              width: 28,
              height: 28,
              margin: const EdgeInsets.only(top: 1),
              decoration: BoxDecoration(
                color: done ? EduColors.lime : Colors.transparent,
                borderRadius: BorderRadius.circular(9),
                border: Border.all(
                  color: done ? EduColors.lime : EduColors.hairline,
                  width: 1.6,
                ),
              ),
              child: _busy
                  ? const Padding(
                      padding: EdgeInsets.all(6),
                      child: CircularProgressIndicator(strokeWidth: 2, color: EduColors.ink),
                    )
                  : (done
                      ? const Icon(Icons.check_rounded, size: 18, color: EduColors.ink)
                      : null),
            ),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(_kindIcons[kind] ?? Icons.menu_book_rounded,
                        size: 16, color: EduColors.inkFaint),
                    const SizedBox(width: 6),
                    Expanded(
                      child: Text(
                        task['title'] as String? ?? '',
                        style: EduText.body.copyWith(
                          fontWeight: FontWeight.w500,
                          decoration: done ? TextDecoration.lineThrough : null,
                          decorationColor: EduColors.inkFaint,
                        ),
                      ),
                    ),
                  ],
                ),
                if ((task['description'] as String?)?.isNotEmpty ?? false) ...[
                  const SizedBox(height: 4),
                  Text(task['description'] as String, style: EduText.bodySm),
                ],
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    if (minutes != null) _Tag(text: '$minutes min'),
                    // Worth distinguishing: one of these a mentor agreed with
                    // them in person, the other an assistant scheduled.
                    _Tag(text: fromMentor ? 'from your mentor' : 'from Planly'),
                  ],
                ),
                if (activityId != null && !done) ...[
                  const SizedBox(height: 10),
                  FilledButton(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => ActivityScreen(
                          data: widget.data,
                          activityId: activityId,
                        ),
                      ),
                    ),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(0, 40),
                      backgroundColor: EduColors.ink,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(EduRadius.control),
                      ),
                    ),
                    child: Text(kind == 'coding' ? 'Open exercise' : 'Start quiz'),
                  ),
                ],
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Tag extends StatelessWidget {
  const _Tag({required this.text});

  final String text;

  @override
  Widget build(BuildContext context) => Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 3),
        decoration: BoxDecoration(
          color: EduColors.sunk,
          borderRadius: BorderRadius.circular(EduRadius.pill),
        ),
        child: Text(
          text,
          style: const TextStyle(fontSize: 11.5, color: EduColors.inkMuted),
        ),
      );
}

/// Exposed so other screens can reach a student's activities collection.
extension ActivityQueries on StudentData {
  Stream<List<Map<String, dynamic>>> activities() => FirebaseFirestore.instance
      .collection('students')
      .doc(usn)
      .collection('activities')
      .snapshots()
      .map((q) => q.docs.map((d) => {...d.data(), 'activityId': d.id}).toList());
}
