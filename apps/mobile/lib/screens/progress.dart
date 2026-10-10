import 'package:flutter/material.dart';

import '../data.dart';
import '../theme.dart';
import '../widgets.dart';

/// Progress over time, and the before/after of any support that was agreed.
///
/// The chart is drawn by hand rather than pulled from a charting package: one
/// series with level bands behind it is less code than configuring a library,
/// and it keeps the app's dependency list to Firebase plus Flutter.
class ProgressScreen extends StatelessWidget {
  const ProgressScreen({super.key, required this.data});

  final StudentData data;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: EduColors.canvas,
      appBar: AppBar(title: const Text('Progress')),
      body: StreamBuilder<List<Map<String, dynamic>>>(
        stream: data.history(),
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator(color: EduColors.ink));
          }

          final history = snap.data ?? const [];
          if (history.isEmpty) {
            return const Padding(
              padding: EdgeInsets.all(20),
              child: EduEmpty(
                title: 'Nothing to chart yet',
                body: 'Your progress appears here once your college has uploaded results '
                    'at least once.',
              ),
            );
          }

          final first = history.first;
          final last = history.last;
          final firstScore = (first['score'] as num?)?.toDouble() ?? 0;
          final lastScore = (last['score'] as num?)?.toDouble() ?? 0;
          final change = lastScore - firstScore;

          return StreamBuilder<Map<String, dynamic>?>(
            stream: StudentData.riskRules(),
            builder: (context, rulesSnap) {
              final cutoffs =
                  (rulesSnap.data?['levelCutoffs'] as Map?)?.cast<String, dynamic>() ??
                      const {'watch': 25, 'atRisk': 45, 'critical': 70};

              return ListView(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 110),
                children: [
                  EduCard(
                    title: 'Risk score over time',
                    hint: '${history.length} update${history.length == 1 ? '' : 's'}',
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        SizedBox(
                          height: 170,
                          child: CustomPaint(
                            size: Size.infinite,
                            painter: _HistoryPainter(
                              scores: history
                                  .map((s) => (s['score'] as num?)?.toDouble() ?? 0)
                                  .toList(),
                              watch: (cutoffs['watch'] as num?)?.toDouble() ?? 25,
                              atRisk: (cutoffs['atRisk'] as num?)?.toDouble() ?? 45,
                              critical: (cutoffs['critical'] as num?)?.toDouble() ?? 70,
                            ),
                          ),
                        ),
                        const SizedBox(height: 10),
                        const Text(
                          'Lower is better. The bands behind the line are the risk levels.',
                          style: EduText.bodySm,
                        ),
                      ],
                    ),
                  ),

                  if (history.length >= 2) ...[
                    const SizedBox(height: 14),
                    EduCard(
                      title: 'Since your first result',
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.end,
                        children: [
                          _Figure(
                            value: firstScore,
                            label: 'then',
                            level: first['level'] as String? ?? 'stable',
                          ),
                          const Padding(
                            padding: EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                            child: Icon(Icons.arrow_forward_rounded, color: EduColors.inkFaint),
                          ),
                          _Figure(
                            value: lastScore,
                            label: 'now',
                            level: last['level'] as String? ?? 'stable',
                          ),
                          const Spacer(),
                          if (change.abs() >= 2)
                            Padding(
                              padding: const EdgeInsets.only(bottom: 6),
                              child: Container(
                                padding:
                                    const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                                decoration: BoxDecoration(
                                  color: EduColors.fillFor(change < 0 ? 'stable' : 'critical'),
                                  borderRadius: BorderRadius.circular(EduRadius.pill),
                                ),
                                child: Text(
                                  change < 0 ? 'improved' : 'worsened',
                                  style: TextStyle(
                                    fontSize: 12,
                                    fontWeight: FontWeight.w600,
                                    color:
                                        EduColors.textFor(change < 0 ? 'stable' : 'critical'),
                                  ),
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],

                  const SizedBox(height: 14),
                  _IndicatorBreakdown(snapshot: last),
                ],
              );
            },
          );
        },
      ),
    );
  }
}

class _Figure extends StatelessWidget {
  const _Figure({required this.value, required this.label, required this.level});

  final double value;
  final String label;
  final String level;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          value.toStringAsFixed(1),
          style: EduText.metric.copyWith(color: EduColors.textFor(level)),
        ),
        const SizedBox(height: 2),
        Text(label, style: EduText.bodySm),
      ],
    );
  }
}

/// Each indicator with its own threshold — the same idea as the dashboard's
/// indicator band, so a student sees exactly what their mentor sees.
class _IndicatorBreakdown extends StatelessWidget {
  const _IndicatorBreakdown({required this.snapshot});

  final Map<String, dynamic> snapshot;

  static const _labels = {
    'attendance': 'Attendance',
    'assessment': 'Assessment average',
    'submission': 'Submissions',
  };

  @override
  Widget build(BuildContext context) {
    final indicators = (snapshot['indicators'] as Map?)?.cast<String, dynamic>() ?? {};
    final level = snapshot['level'] as String? ?? 'stable';

    return EduCard(
      title: 'Where you stand',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          for (final entry in _labels.entries)
            Builder(
              builder: (context) {
                final indicator =
                    (indicators[entry.key] as Map?)?.cast<String, dynamic>() ?? const {};
                final available = indicator['available'] == true;
                final value = (indicator['value'] as num?)?.toDouble();
                final reason = indicator['reason'] as String? ?? '';

                return Padding(
                  padding: const EdgeInsets.only(bottom: 18),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Text(entry.value, style: EduText.body.copyWith(
                            fontWeight: FontWeight.w500,
                          )),
                          Text(
                            available && value != null
                                ? '${value.toStringAsFixed(1)}%'
                                : 'No data',
                            style: EduText.body.copyWith(
                              fontWeight: FontWeight.w600,
                              color: available ? EduColors.ink : EduColors.inkFaint,
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      ClipRRect(
                        borderRadius: BorderRadius.circular(EduRadius.pill),
                        child: LinearProgressIndicator(
                          value: available && value != null ? (value / 100).clamp(0, 1) : 0,
                          minHeight: 9,
                          backgroundColor: EduColors.sunk,
                          valueColor: AlwaysStoppedAnimation(EduColors.textFor(level)),
                        ),
                      ),
                      const SizedBox(height: 6),
                      Text(reason, style: EduText.bodySm),
                    ],
                  ),
                );
              },
            ),
        ],
      ),
    );
  }
}

class _HistoryPainter extends CustomPainter {
  _HistoryPainter({
    required this.scores,
    required this.watch,
    required this.atRisk,
    required this.critical,
  });

  final List<double> scores;
  final double watch;
  final double atRisk;
  final double critical;

  @override
  void paint(Canvas canvas, Size size) {
    double y(double score) => size.height - (score.clamp(0, 100) / 100) * size.height;

    // Level bands, so a student sees which side of a threshold they moved.
    void band(double from, double to, Color colour) {
      canvas.drawRect(
        Rect.fromLTRB(0, y(to), size.width, y(from)),
        Paint()..color = colour.withValues(alpha: 0.55),
      );
    }

    band(0, watch, EduColors.fillFor('stable'));
    band(watch, atRisk, EduColors.fillFor('watch'));
    band(atRisk, critical, EduColors.fillFor('at_risk'));
    band(critical, 100, EduColors.fillFor('critical'));

    if (scores.length < 2) {
      if (scores.length == 1) {
        canvas.drawCircle(
          Offset(size.width / 2, y(scores.first)),
          5,
          Paint()..color = EduColors.ink,
        );
      }
      return;
    }

    final step = size.width / (scores.length - 1);
    final path = Path();
    for (var i = 0; i < scores.length; i += 1) {
      final point = Offset(i * step, y(scores[i]));
      if (i == 0) {
        path.moveTo(point.dx, point.dy);
      } else {
        path.lineTo(point.dx, point.dy);
      }
    }

    canvas.drawPath(
      path,
      Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = 2.4
        ..strokeCap = StrokeCap.round
        ..strokeJoin = StrokeJoin.round
        ..color = EduColors.ink,
    );

    for (var i = 0; i < scores.length; i += 1) {
      final point = Offset(i * step, y(scores[i]));
      canvas.drawCircle(point, 5, Paint()..color = EduColors.lime);
      canvas.drawCircle(
        point,
        5,
        Paint()
          ..style = PaintingStyle.stroke
          ..strokeWidth = 1.6
          ..color = EduColors.ink,
      );
    }
  }

  @override
  bool shouldRepaint(_HistoryPainter old) =>
      !_sameScores(old.scores, scores) ||
      old.watch != watch ||
      old.atRisk != atRisk ||
      old.critical != critical;

  static bool _sameScores(List<double> a, List<double> b) {
    if (a.length != b.length) return false;
    for (var i = 0; i < a.length; i += 1) {
      if ((a[i] - b[i]).abs() > 0.001) return false;
    }
    return true;
  }
}
