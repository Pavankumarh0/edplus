import 'package:flutter/material.dart';

import '../data.dart';
import '../theme.dart';
import '../widgets.dart';

/// Recovery tasks, and the one thing a student can write.
///
/// Firestore rules allow exactly `done` and `doneAt` to change on their own
/// tasks — not the title, the due date, or which intervention it belongs to.
/// So this screen is the complete set of student write operations in the
/// system.
class TasksScreen extends StatelessWidget {
  const TasksScreen({super.key, required this.data});

  final StudentData data;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: EduColors.canvas,
      appBar: AppBar(title: const Text('Tasks')),
      body: StreamBuilder<List<Map<String, dynamic>>>(
        stream: data.tasks(),
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator(color: EduColors.ink));
          }

          final tasks = snap.data ?? const [];
          if (tasks.isEmpty) {
            return const Padding(
              padding: EdgeInsets.all(20),
              child: EduEmpty(
                title: 'No tasks right now',
                body: 'When your mentor agrees a plan with you, the steps appear here — '
                    'small things you can finish in a week.',
              ),
            );
          }

          final done = tasks.where((t) => t['done'] == true).length;

          return ListView(
            padding: const EdgeInsets.fromLTRB(20, 4, 20, 110),
            children: [
              EduCard(
                title: 'Progress',
                hint: '$done of ${tasks.length}',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    SegmentedProgress(done: done, total: tasks.length),
                    const SizedBox(height: 12),
                    Text(
                      done == tasks.length
                          ? 'All done. Your next set of results will show whether it helped.'
                          : '${tasks.length - done} left. Tick them off as you finish.',
                      style: EduText.bodySm,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: 14),

              for (final task in tasks)
                Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: _TaskTile(data: data, task: task),
                ),
            ],
          );
        },
      ),
    );
  }
}

class _TaskTile extends StatefulWidget {
  const _TaskTile({required this.data, required this.task});

  final StudentData data;
  final Map<String, dynamic> task;

  @override
  State<_TaskTile> createState() => _TaskTileState();
}

class _TaskTileState extends State<_TaskTile> {
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
    final done = widget.task['done'] == true;
    final title = widget.task['title'] as String? ?? '';
    final description = widget.task['description'] as String?;
    final dueDate = widget.task['dueDate'] as String?;

    return Opacity(
      opacity: done ? 0.62 : 1,
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: EduColors.surface,
          borderRadius: BorderRadius.circular(EduRadius.card),
          border: Border.all(color: done ? EduColors.hairline : EduColors.ink.withValues(alpha: 0.12)),
        ),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Semantics(
              checked: done,
              label: title,
              child: GestureDetector(
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
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    title,
                    style: EduText.body.copyWith(
                      fontWeight: FontWeight.w500,
                      decoration: done ? TextDecoration.lineThrough : null,
                      decorationColor: EduColors.inkFaint,
                    ),
                  ),
                  if (description != null && description.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Text(description, style: EduText.bodySm),
                  ],
                  if (dueDate != null && dueDate.isNotEmpty) ...[
                    const SizedBox(height: 8),
                    Container(
                      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                      decoration: BoxDecoration(
                        color: EduColors.sunk,
                        borderRadius: BorderRadius.circular(EduRadius.pill),
                      ),
                      child: Text(
                        'by $dueDate',
                        style: const TextStyle(fontSize: 11.5, color: EduColors.inkMuted),
                      ),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
