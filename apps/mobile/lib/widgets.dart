import 'dart:math' as math;
import 'package:flutter/material.dart';
import 'theme.dart';

/// A level pill. Always carries the written label — colour is never the only
/// signal, in either app.
class LevelPill extends StatelessWidget {
  const LevelPill({
    super.key,
    required this.level,
    this.insufficientData = false,
    this.compact = false,
  });

  final String level;
  final bool insufficientData;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final text = EduColors.textFor(level, insufficientData: insufficientData);
    final fill = EduColors.fillFor(level, insufficientData: insufficientData);

    return Container(
      padding: EdgeInsets.symmetric(horizontal: compact ? 10 : 14, vertical: compact ? 4 : 7),
      decoration: BoxDecoration(
        color: fill,
        borderRadius: BorderRadius.circular(EduRadius.pill),
        border: Border.all(color: text.withValues(alpha: 0.35)),
      ),
      child: Text(
        labelFor(level, insufficientData: insufficientData),
        style: TextStyle(
          color: text,
          fontSize: compact ? 12 : 13,
          fontWeight: FontWeight.w600,
        ),
      ),
    );
  }
}

/// Segmented progress bar — the brief's "progress bars made of segments".
///
/// Segments rather than a continuous bar because a student can count them.
/// "5 of 8" is a fact you can act on; 62% of a smooth bar is not.
class SegmentedProgress extends StatelessWidget {
  const SegmentedProgress({
    super.key,
    required this.done,
    required this.total,
    this.color = EduColors.ink,
    this.height = 10,
  });

  final int done;
  final int total;
  final Color color;
  final double height;

  @override
  Widget build(BuildContext context) {
    final count = math.max(total, 1);
    return Row(
      children: List.generate(count, (index) {
        return Expanded(
          child: Container(
            height: height,
            margin: EdgeInsets.only(right: index == count - 1 ? 0 : 4),
            decoration: BoxDecoration(
              color: index < done ? color : EduColors.sunk,
              borderRadius: BorderRadius.circular(EduRadius.pill),
            ),
          ),
        );
      }),
    );
  }
}

/// Attendance ring.
///
/// Draws the institutional 75% bar as a notch on the track, so the number is
/// never shown without what it is measured against — the same principle as the
/// indicator band on the dashboard.
class AttendanceRing extends StatelessWidget {
  const AttendanceRing({
    super.key,
    required this.percent,
    required this.color,
    this.threshold = 75,
    this.size = 120,
  });

  final double? percent;
  final Color color;
  final double threshold;
  final double size;

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CustomPaint(
        painter: _RingPainter(percent: percent, color: color, threshold: threshold),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                percent == null ? '—' : '${percent!.toStringAsFixed(0)}%',
                style: EduText.metric.copyWith(fontSize: size * 0.24),
              ),
              const SizedBox(height: 2),
              const Text('attendance', style: TextStyle(fontSize: 11, color: EduColors.inkMuted)),
            ],
          ),
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter({required this.percent, required this.color, required this.threshold});

  final double? percent;
  final Color color;
  final double threshold;

  @override
  void paint(Canvas canvas, Size size) {
    const stroke = 11.0;
    final rect = Offset(stroke / 2, stroke / 2) &
        Size(size.width - stroke, size.height - stroke);
    const start = -math.pi / 2;

    final track = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = stroke
      ..strokeCap = StrokeCap.round
      ..color = EduColors.sunk;
    canvas.drawArc(rect, start, math.pi * 2, false, track);

    if (percent != null) {
      final sweep = (percent!.clamp(0, 100) / 100) * math.pi * 2;
      final fill = Paint()
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke
        ..strokeCap = StrokeCap.round
        ..color = color;
      canvas.drawArc(rect, start, sweep, false, fill);
    }

    // The eligibility bar, drawn as a notch.
    final notchAngle = start + (threshold / 100) * math.pi * 2;
    final centre = Offset(size.width / 2, size.height / 2);
    final radius = (size.width - stroke) / 2;
    final inner = centre + Offset(math.cos(notchAngle), math.sin(notchAngle)) * (radius - stroke / 2 - 1);
    final outer = centre + Offset(math.cos(notchAngle), math.sin(notchAngle)) * (radius + stroke / 2 + 1);

    canvas.drawLine(
      inner,
      outer,
      Paint()
        ..strokeWidth = 2
        ..strokeCap = StrokeCap.round
        ..color = EduColors.ink.withValues(alpha: 0.55),
    );
  }

  @override
  bool shouldRepaint(_RingPainter old) =>
      old.percent != percent || old.color != color || old.threshold != threshold;
}

/// A horizontal date strip, as in the mobile reference direction.
class DateStrip extends StatelessWidget {
  const DateStrip({super.key, required this.selected, required this.onSelect});

  final DateTime selected;
  final ValueChanged<DateTime> onSelect;

  @override
  Widget build(BuildContext context) {
    final today = DateTime.now();
    final days = List.generate(14, (i) => today.subtract(Duration(days: 6 - i)));
    const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

    return SizedBox(
      height: 70,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16),
        itemCount: days.length,
        separatorBuilder: (_, __) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final day = days[index];
          final isSelected = day.year == selected.year &&
              day.month == selected.month &&
              day.day == selected.day;
          final isFuture = day.isAfter(today);

          return GestureDetector(
            onTap: isFuture ? null : () => onSelect(day),
            child: Container(
              width: 52,
              decoration: BoxDecoration(
                color: isSelected ? EduColors.ink : EduColors.surface,
                borderRadius: BorderRadius.circular(EduRadius.pill),
                border: Border.all(color: EduColors.hairline),
              ),
              child: Column(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Text(
                    names[day.weekday - 1],
                    style: TextStyle(
                      fontSize: 11,
                      color: isSelected
                          ? EduColors.canvas.withValues(alpha: 0.7)
                          : (isFuture ? EduColors.inkFaint : EduColors.inkMuted),
                    ),
                  ),
                  const SizedBox(height: 3),
                  Text(
                    '${day.day}',
                    style: TextStyle(
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                      color: isSelected
                          ? EduColors.canvas
                          : (isFuture ? EduColors.inkFaint : EduColors.ink),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}

/// A plain section card.
class EduCard extends StatelessWidget {
  const EduCard({super.key, required this.child, this.padding = 20, this.title, this.hint});

  final Widget child;
  final double padding;
  final String? title;
  final String? hint;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: EdgeInsets.all(padding),
      decoration: BoxDecoration(
        color: EduColors.surface,
        borderRadius: BorderRadius.circular(EduRadius.card),
        border: Border.all(color: EduColors.hairline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (title != null) ...[
            Row(
              mainAxisAlignment: MainAxisAlignment.spaceBetween,
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(title!, style: EduText.h2),
                if (hint != null)
                  Flexible(
                    child: Text(
                      hint!,
                      textAlign: TextAlign.right,
                      style: EduText.bodySm.copyWith(color: EduColors.inkFaint),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 14),
          ],
          child,
        ],
      ),
    );
  }
}

/// An empty state that says what to do, rather than apologising.
class EduEmpty extends StatelessWidget {
  const EduEmpty({super.key, required this.title, this.body});

  final String title;
  final String? body;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 20, vertical: 32),
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(EduRadius.card),
        border: Border.all(color: EduColors.hairline, style: BorderStyle.solid),
      ),
      child: Column(
        children: [
          Text(title, style: EduText.h2, textAlign: TextAlign.center),
          if (body != null) ...[
            const SizedBox(height: 6),
            Text(body!, style: EduText.bodySm, textAlign: TextAlign.center),
          ],
        ],
      ),
    );
  }
}
