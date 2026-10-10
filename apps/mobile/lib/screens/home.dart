import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../data.dart';
import '../theme.dart';
import '../widgets.dart';

/// The student's own position, in plain words.
///
/// Leads with the LEVEL, not the number. "Watch" is something a student can
/// understand and act on; 36.7 on its own means nothing to them. The number is
/// there, smaller, for anyone who wants it.
class HomeScreen extends StatefulWidget {
  const HomeScreen({super.key, required this.data});

  final StudentData data;

  @override
  State<HomeScreen> createState() => _HomeScreenState();
}

class _HomeScreenState extends State<HomeScreen> {
  DateTime _selected = DateTime.now();

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: EduColors.canvas,
      body: SafeArea(
        bottom: false,
        child: StreamBuilder<Map<String, dynamic>?>(
          stream: widget.data.student(),
          builder: (context, studentSnap) {
            final name = (studentSnap.data?['name'] as String?) ?? '';
            final firstName = name.isEmpty ? 'there' : name.split(' ').first;

            return ListView(
              padding: const EdgeInsets.only(bottom: 110),
              children: [
                Padding(
                  padding: const EdgeInsets.fromLTRB(20, 8, 20, 0),
                  child: Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text('Hello, $firstName', style: EduText.h1),
                          const SizedBox(height: 2),
                          Text(widget.data.usn, style: EduText.bodySm),
                        ],
                      ),
                      IconButton(
                        tooltip: 'Sign out',
                        onPressed: () => FirebaseAuth.instance.signOut(),
                        icon: const Icon(Icons.logout_rounded, color: EduColors.inkMuted),
                      ),
                    ],
                  ),
                ),
                const SizedBox(height: 10),

                DateStrip(selected: _selected, onSelect: (d) => setState(() => _selected = d)),
                const SizedBox(height: 18),

                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: _StatusCard(data: widget.data),
                ),
                const SizedBox(height: 14),

                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: _AttendanceCard(data: widget.data),
                ),
                const SizedBox(height: 14),

                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 20),
                  child: _TodayTasks(data: widget.data),
                ),
              ],
            );
          },
        ),
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({required this.data});

  final StudentData data;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<Map<String, dynamic>?>(
      stream: data.latestSnapshot(),
      builder: (context, snap) {
        if (!snap.hasData && snap.connectionState == ConnectionState.waiting) {
          return const _CardSkeleton(height: 210);
        }

        final snapshot = snap.data;
        if (snapshot == null) {
          return const EduEmpty(
            title: 'No results yet',
            body: 'Once your college uploads this term’s attendance and marks, your '
                'progress appears here.',
          );
        }

        final level = (snapshot['level'] as String?) ?? 'stable';
        final insufficient = snapshot['insufficientData'] == true;
        final score = (snapshot['score'] as num?)?.toDouble() ?? 0;
        final delta = (snapshot['scoreDelta'] as num?)?.toDouble();
        final gradient = EduColors.gradientFor(level, insufficientData: insufficient);

        return Container(
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: gradient,
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(EduRadius.hero),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              LevelPill(level: level, insufficientData: insufficient),
              const SizedBox(height: 14),

              // Plain words first. The number is supporting evidence.
              Text(
                _headline(level, insufficient, delta),
                style: EduText.h1.copyWith(fontSize: 21, height: 1.3),
              ),
              const SizedBox(height: 10),

              Text(_why(snapshot), style: EduText.body.copyWith(color: EduColors.ink)),

              if (delta != null && delta.abs() >= 2) ...[
                const SizedBox(height: 12),
                Row(
                  children: [
                    Icon(
                      delta < 0 ? Icons.trending_down_rounded : Icons.trending_up_rounded,
                      size: 18,
                      color: EduColors.textFor(delta < 0 ? 'stable' : 'critical'),
                    ),
                    const SizedBox(width: 6),
                    Text(
                      delta < 0
                          ? 'Down ${delta.abs().toStringAsFixed(1)} points since last time — that is progress.'
                          : 'Up ${delta.abs().toStringAsFixed(1)} points since last time.',
                      style: EduText.bodySm.copyWith(color: EduColors.ink),
                    ),
                  ],
                ),
              ],

              const SizedBox(height: 16),
              Row(
                crossAxisAlignment: CrossAxisAlignment.end,
                children: [
                  Text(score.toStringAsFixed(1), style: EduText.metric),
                  const SizedBox(width: 8),
                  const Padding(
                    padding: EdgeInsets.only(bottom: 5),
                    child: Text('risk score · lower is better', style: EduText.bodySm),
                  ),
                ],
              ),
            ],
          ),
        );
      },
    );
  }

  /// One sentence a student can act on, not a label repeated back at them.
  String _headline(String level, bool insufficient, double? delta) {
    if (insufficient) return 'We don’t have enough of your results yet';
    if (delta != null && delta <= -10) return 'You are moving in the right direction';
    switch (level) {
      case 'stable':
        return 'You are on track';
      case 'watch':
        return 'A couple of things need attention';
      case 'at_risk':
        return 'Some subjects need work now';
      case 'critical':
        return 'Let’s get you back on track';
      default:
        return 'Your progress';
    }
  }

  /// The "why", taken verbatim from the engine's own reason strings so the app
  /// and the dashboard never explain the same number differently.
  String _why(Map<String, dynamic> snapshot) {
    if (snapshot['insufficientData'] == true) {
      final gaps = (snapshot['dataGaps'] as List?)?.cast<String>() ?? const [];
      return gaps.isEmpty
          ? 'Your college has not uploaded enough results to assess you yet.'
          : gaps.first;
    }

    final indicators = (snapshot['indicators'] as Map?)?.cast<String, dynamic>() ?? {};
    final reasons = <String>[];

    for (final key in ['attendance', 'assessment', 'submission']) {
      final indicator = (indicators[key] as Map?)?.cast<String, dynamic>();
      if (indicator == null || indicator['available'] != true) continue;
      final sub = (indicator['subScore'] as num?)?.toDouble() ?? 0;
      if (sub > 0) reasons.add(indicator['reason'] as String? ?? '');
    }

    if (reasons.isEmpty) return 'Everything is above its threshold. Keep it there.';
    return reasons.take(2).join(' ');
  }
}

class _AttendanceCard extends StatelessWidget {
  const _AttendanceCard({required this.data});

  final StudentData data;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<Map<String, dynamic>>>(
      stream: data.records(type: 'attendance'),
      builder: (context, snap) {
        final records = snap.data ?? const [];
        final percent = percentOf(records);

        return StreamBuilder<Map<String, dynamic>?>(
          stream: data.latestSnapshot(),
          builder: (context, snapshotSnap) {
            final level = (snapshotSnap.data?['level'] as String?) ?? 'stable';

            return EduCard(
              title: 'Attendance',
              hint: records.isEmpty ? null : '${records.length} subjects',
              child: Row(
                children: [
                  AttendanceRing(percent: percent, color: EduColors.textFor(level)),
                  const SizedBox(width: 18),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          percent == null
                              ? 'No attendance recorded yet.'
                              : percent >= 75
                                  ? 'You are above the 75% requirement.'
                                  : 'Below the 75% requirement for exam eligibility.',
                          style: EduText.body,
                        ),
                        const SizedBox(height: 8),
                        const Text(
                          'The notch on the ring marks 75%.',
                          style: EduText.bodySm,
                        ),
                      ],
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }
}

class _TodayTasks extends StatelessWidget {
  const _TodayTasks({required this.data});

  final StudentData data;

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<List<Map<String, dynamic>>>(
      stream: data.tasks(),
      builder: (context, snap) {
        final tasks = snap.data ?? const [];
        final open = tasks.where((t) => t['done'] != true).toList();
        final doneCount = tasks.length - open.length;

        return EduCard(
          title: 'Your tasks',
          hint: tasks.isEmpty ? null : '$doneCount of ${tasks.length} done',
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (tasks.isNotEmpty) ...[
                SegmentedProgress(done: doneCount, total: tasks.length),
                const SizedBox(height: 16),
              ],
              if (tasks.isEmpty)
                const Text(
                  'Nothing to do right now. Your mentor will add tasks here if you need them.',
                  style: EduText.bodySm,
                )
              else if (open.isEmpty)
                const Text(
                  'Everything done. Nicely handled.',
                  style: EduText.body,
                )
              else
                ...open.take(3).map(
                      (task) => Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(Icons.radio_button_unchecked,
                                size: 18, color: EduColors.inkFaint),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(task['title'] as String? ?? '', style: EduText.body),
                            ),
                          ],
                        ),
                      ),
                    ),
            ],
          ),
        );
      },
    );
  }
}

class _CardSkeleton extends StatelessWidget {
  const _CardSkeleton({required this.height});

  final double height;

  @override
  Widget build(BuildContext context) => Container(
        height: height,
        decoration: BoxDecoration(
          color: EduColors.sunk,
          borderRadius: BorderRadius.circular(EduRadius.hero),
        ),
      );
}
