import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../data.dart';
import '../theme.dart';
import '../widgets.dart';

/// Runs a generated quiz or shows a coding exercise.
///
/// A quiz shows the explanation after every answer, right or wrong — a quiz
/// that only scores teaches nothing, and these students already believe they
/// are bad at the subject. The score is recorded for their own feedback and
/// deliberately never reaches the risk engine: it is practice an AI wrote, not
/// an assessment the college set.
class ActivityScreen extends StatefulWidget {
  const ActivityScreen({super.key, required this.data, required this.activityId});

  final StudentData data;
  final String activityId;

  @override
  State<ActivityScreen> createState() => _ActivityScreenState();
}

class _ActivityScreenState extends State<ActivityScreen> {
  int _index = 0;
  final Map<int, int> _chosen = {};
  bool _submitting = false;
  bool _finished = false;

  DocumentReference<Map<String, dynamic>> get _ref => FirebaseFirestore.instance
      .collection('students')
      .doc(widget.data.usn)
      .collection('activities')
      .doc(widget.activityId);

  Future<void> _finish(List<dynamic> questions) async {
    setState(() => _submitting = true);
    var score = 0;
    for (var i = 0; i < questions.length; i += 1) {
      final correct = (questions[i] as Map)['answerIndex'] as int?;
      if (correct != null && _chosen[i] == correct) score += 1;
    }

    try {
      // The rules allow exactly these four fields, and only a score within
      // range — a student cannot write themselves full marks.
      await _ref.update({
        'status': 'completed',
        'score': score,
        'outOf': questions.length,
        'attemptedAt': DateTime.now().toUtc().toIso8601String(),
      });
      if (mounted) setState(() => _finished = true);
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not save your score. Check your connection.')),
        );
      }
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: EduColors.canvas,
      appBar: AppBar(title: const Text('Practice')),
      body: StreamBuilder<DocumentSnapshot<Map<String, dynamic>>>(
        stream: _ref.snapshots(),
        builder: (context, snap) {
          if (snap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator(color: EduColors.ink));
          }

          final activity = snap.data?.data();
          if (activity == null) {
            return const Padding(
              padding: EdgeInsets.all(20),
              child: EduEmpty(title: 'This activity is no longer available'),
            );
          }

          final kind = activity['kind'] as String? ?? 'quiz';
          return kind == 'coding'
              ? _Coding(activity: activity)
              : _Quiz(
                  activity: activity,
                  index: _index,
                  chosen: _chosen,
                  finished: _finished || activity['status'] == 'completed',
                  submitting: _submitting,
                  onChoose: (i, option) => setState(() => _chosen[i] = option),
                  onNext: () => setState(() => _index += 1),
                  onFinish: (questions) => _finish(questions),
                );
        },
      ),
    );
  }
}

class _Quiz extends StatelessWidget {
  const _Quiz({
    required this.activity,
    required this.index,
    required this.chosen,
    required this.finished,
    required this.submitting,
    required this.onChoose,
    required this.onNext,
    required this.onFinish,
  });

  final Map<String, dynamic> activity;
  final int index;
  final Map<int, int> chosen;
  final bool finished;
  final bool submitting;
  final void Function(int questionIndex, int optionIndex) onChoose;
  final VoidCallback onNext;
  final void Function(List<dynamic> questions) onFinish;

  @override
  Widget build(BuildContext context) {
    final questions = (activity['questions'] as List?) ?? const [];
    if (questions.isEmpty) {
      return const Padding(
        padding: EdgeInsets.all(20),
        child: EduEmpty(title: 'This quiz has no questions'),
      );
    }

    if (finished) {
      final score = activity['score'] as int?;
      final outOf = activity['outOf'] as int? ?? questions.length;
      return ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
        children: [
          EduCard(
            title: 'Done',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('$score out of $outOf', style: EduText.metric),
                const SizedBox(height: 8),
                Text(
                  score == null
                      ? ''
                      : score == outOf
                          ? 'All correct. Worth telling your mentor.'
                          : score >= outOf / 2
                              ? 'A solid attempt. Read the explanations for the ones you missed.'
                              : 'This one was hard. The explanations below are the useful part — '
                                  'go through them rather than retaking it straight away.',
                  style: EduText.bodySm,
                ),
                const SizedBox(height: 10),
                Text(
                  'Practice scores are for you. They do not change your risk score — only '
                  'your real attendance, marks and submissions do that.',
                  style: EduText.bodySm.copyWith(color: EduColors.inkFaint),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),
          for (var i = 0; i < questions.length; i += 1)
            Padding(
              padding: const EdgeInsets.only(bottom: 12),
              child: _Review(
                question: (questions[i] as Map).cast<String, dynamic>(),
                chosen: chosen[i],
              ),
            ),
        ],
      );
    }

    final safeIndex = index.clamp(0, questions.length - 1);
    final question = (questions[safeIndex] as Map).cast<String, dynamic>();
    final options = (question['options'] as List?)?.cast<String>() ?? const [];
    final picked = chosen[safeIndex];
    final answered = picked != null;
    final correct = question['answerIndex'] as int?;
    final isLast = safeIndex == questions.length - 1;

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
      children: [
        Text(
          '${activity['subject']} · question ${safeIndex + 1} of ${questions.length}',
          style: EduText.bodySm,
        ),
        const SizedBox(height: 6),
        SegmentedProgress(done: safeIndex, total: questions.length),
        const SizedBox(height: 18),

        Text(question['question'] as String? ?? '', style: EduText.h1.copyWith(fontSize: 20)),
        const SizedBox(height: 18),

        for (var o = 0; o < options.length; o += 1)
          Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: _Option(
              text: options[o],
              state: !answered
                  ? _OptionState.idle
                  : o == correct
                      ? _OptionState.correct
                      : (o == picked ? _OptionState.wrong : _OptionState.idle),
              onTap: answered ? null : () => onChoose(safeIndex, o),
            ),
          ),

        if (answered) ...[
          const SizedBox(height: 6),
          Container(
            padding: const EdgeInsets.all(14),
            decoration: BoxDecoration(
              color: EduColors.sunk,
              borderRadius: BorderRadius.circular(EduRadius.control),
            ),
            child: Text(question['explanation'] as String? ?? '', style: EduText.body),
          ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: submitting ? null : () => isLast ? onFinish(questions) : onNext(),
            child: Text(
              submitting ? 'Saving…' : (isLast ? 'Finish' : 'Next question'),
            ),
          ),
        ],
      ],
    );
  }
}

enum _OptionState { idle, correct, wrong }

class _Option extends StatelessWidget {
  const _Option({required this.text, required this.state, required this.onTap});

  final String text;
  final _OptionState state;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final border = switch (state) {
      _OptionState.correct => EduColors.textFor('stable'),
      _OptionState.wrong => EduColors.textFor('critical'),
      _OptionState.idle => EduColors.hairline,
    };
    final fill = switch (state) {
      _OptionState.correct => EduColors.fillFor('stable'),
      _OptionState.wrong => EduColors.fillFor('critical'),
      _OptionState.idle => EduColors.surface,
    };

    return GestureDetector(
      onTap: onTap,
      behavior: HitTestBehavior.opaque,
      child: Container(
        width: double.infinity,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 14),
        decoration: BoxDecoration(
          color: fill,
          borderRadius: BorderRadius.circular(EduRadius.control),
          border: Border.all(color: border, width: state == _OptionState.idle ? 1 : 1.6),
        ),
        child: Row(
          children: [
            Expanded(child: Text(text, style: EduText.body)),
            if (state == _OptionState.correct)
              Icon(Icons.check_rounded, size: 20, color: EduColors.textFor('stable')),
            if (state == _OptionState.wrong)
              Icon(Icons.close_rounded, size: 20, color: EduColors.textFor('critical')),
          ],
        ),
      ),
    );
  }
}

class _Review extends StatelessWidget {
  const _Review({required this.question, required this.chosen});

  final Map<String, dynamic> question;
  final int? chosen;

  @override
  Widget build(BuildContext context) {
    final options = (question['options'] as List?)?.cast<String>() ?? const [];
    final correct = question['answerIndex'] as int?;
    final gotIt = chosen != null && chosen == correct;

    return EduCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                gotIt ? Icons.check_circle_rounded : Icons.cancel_rounded,
                size: 18,
                color: EduColors.textFor(gotIt ? 'stable' : 'critical'),
              ),
              const SizedBox(width: 8),
              Expanded(
                child: Text(
                  question['question'] as String? ?? '',
                  style: EduText.body.copyWith(fontWeight: FontWeight.w500),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          if (correct != null && correct < options.length)
            Text('Answer: ${options[correct]}', style: EduText.bodySm),
          const SizedBox(height: 6),
          Text(question['explanation'] as String? ?? '', style: EduText.bodySm),
        ],
      ),
    );
  }
}

class _Coding extends StatelessWidget {
  const _Coding({required this.activity});

  final Map<String, dynamic> activity;

  @override
  Widget build(BuildContext context) {
    final coding = (activity['coding'] as Map?)?.cast<String, dynamic>() ?? const {};
    final acceptance = (coding['acceptance'] as List?)?.cast<String>() ?? const [];
    final hints = (coding['hints'] as List?)?.cast<String>() ?? const [];
    final starter = coding['starterCode'] as String?;

    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
      children: [
        Text('${activity['subject']} · ${coding['language'] ?? 'code'}', style: EduText.bodySm),
        const SizedBox(height: 6),
        Text(activity['title'] as String? ?? '', style: EduText.h1.copyWith(fontSize: 21)),
        const SizedBox(height: 14),

        EduCard(
          title: 'What to build',
          child: Text(coding['brief'] as String? ?? '', style: EduText.body),
        ),
        const SizedBox(height: 14),

        if (acceptance.isNotEmpty)
          EduCard(
            title: 'Done when',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (final item in acceptance)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 8),
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Icon(Icons.check_box_outline_blank_rounded,
                            size: 17, color: EduColors.inkFaint),
                        const SizedBox(width: 9),
                        Expanded(child: Text(item, style: EduText.body)),
                      ],
                    ),
                  ),
              ],
            ),
          ),

        if (starter != null && starter.isNotEmpty) ...[
          const SizedBox(height: 14),
          EduCard(
            title: 'Starter',
            child: Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: EduColors.ink,
                borderRadius: BorderRadius.circular(EduRadius.control),
              ),
              child: SelectableText(
                starter,
                style: const TextStyle(
                  fontFamily: 'monospace',
                  fontSize: 12.5,
                  height: 1.5,
                  color: EduColors.canvas,
                ),
              ),
            ),
          ),
        ],

        if (hints.isNotEmpty) ...[
          const SizedBox(height: 14),
          EduCard(
            title: 'Stuck?',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                for (var i = 0; i < hints.length; i += 1)
                  ExpansionTile(
                    tilePadding: EdgeInsets.zero,
                    childrenPadding: const EdgeInsets.only(bottom: 10),
                    shape: const Border(),
                    collapsedShape: const Border(),
                    title: Text('Hint ${i + 1}', style: EduText.body),
                    children: [
                      Align(
                        alignment: Alignment.centerLeft,
                        child: Text(hints[i], style: EduText.bodySm),
                      ),
                    ],
                  ),
              ],
            ),
          ),
        ],

        const SizedBox(height: 14),
        Text(
          'Tick the task off on your schedule once it runs. Your mentor can see that you did it.',
          style: EduText.bodySm.copyWith(color: EduColors.inkFaint),
        ),
      ],
    );
  }
}
