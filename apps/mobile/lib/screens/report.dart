import 'package:flutter/material.dart';

import '../data.dart';
import '../theme.dart';
import '../widgets.dart';

/// The latest report written for this student.
///
/// The report is only shown next to the snapshot it was written for. If a
/// newer snapshot exists, the report describes numbers that have since moved,
/// and the student is told so rather than quietly shown stale advice.
class ReportScreen extends StatelessWidget {
  const ReportScreen({super.key, required this.data});

  final StudentData data;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: EduColors.canvas,
      appBar: AppBar(title: const Text('Your report')),
      body: StreamBuilder<Map<String, dynamic>?>(
        stream: data.latestReport(),
        builder: (context, reportSnap) {
          if (reportSnap.connectionState == ConnectionState.waiting) {
            return const Center(child: CircularProgressIndicator(color: EduColors.ink));
          }

          final report = reportSnap.data;
          if (report == null) {
            return const Padding(
              padding: EdgeInsets.all(20),
              child: EduEmpty(
                title: 'No report yet',
                body: 'Your mentor writes one after your results are uploaded. '
                    'It explains where you stand and exactly what to do next.',
              ),
            );
          }

          final body = (report['body'] as Map?)?.cast<String, dynamic>() ?? {};

          return StreamBuilder<Map<String, dynamic>?>(
            stream: data.latestSnapshot(),
            builder: (context, snapshotSnap) {
              final currentId = snapshotSnap.data?['snapshotId'] as String?;
              final reportId = report['snapshotId'] as String?;
              final stale = currentId != null && reportId != null && currentId != reportId;

              return ListView(
                padding: const EdgeInsets.fromLTRB(20, 4, 20, 110),
                children: [
                  if (stale)
                    Container(
                      width: double.infinity,
                      margin: const EdgeInsets.only(bottom: 16),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                      decoration: BoxDecoration(
                        color: EduColors.fillFor('watch'),
                        borderRadius: BorderRadius.circular(EduRadius.control),
                      ),
                      child: Text(
                        'Your results have been updated since this was written, so some numbers '
                        'here are out of date.',
                        style: TextStyle(color: EduColors.textFor('watch'), fontSize: 13.5),
                      ),
                    ),

                  EduCard(
                    child: Text(
                      body['summary'] as String? ?? '',
                      style: EduText.body.copyWith(fontSize: 16, height: 1.55),
                    ),
                  ),

                  _Section(
                    title: 'Working well',
                    items: (body['strengths'] as List?)?.cast<String>() ?? const [],
                    // An empty strengths list is a correct answer, not a bug —
                    // the report agent is told never to invent praise.
                    emptyNote: 'Nothing stands out yet. That changes once a few weeks of '
                        'steady attendance and submissions are on record.',
                    bullet: Icons.check_rounded,
                    bulletColor: EduColors.textFor('stable'),
                  ),

                  if ((body['concerns'] as List?)?.isNotEmpty ?? false) ...[
                    const SizedBox(height: 14),
                    EduCard(
                      title: 'What needs attention',
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          for (final raw in (body['concerns'] as List))
                            Builder(
                              builder: (context) {
                                final concern = (raw as Map).cast<String, dynamic>();
                                return Padding(
                                  padding: const EdgeInsets.only(bottom: 16),
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        concern['indicator'] as String? ?? '',
                                        style: EduText.h2,
                                      ),
                                      const SizedBox(height: 4),
                                      Text(concern['detail'] as String? ?? '', style: EduText.body),
                                      const SizedBox(height: 4),
                                      Text(
                                        concern['whyItMatters'] as String? ?? '',
                                        style: EduText.bodySm,
                                      ),
                                    ],
                                  ),
                                );
                              },
                            ),
                        ],
                      ),
                    ),
                  ],

                  _Section(
                    title: 'What to do next',
                    items: (body['actions'] as List?)?.cast<String>() ?? const [],
                    emptyNote: 'No specific steps right now.',
                    bullet: Icons.arrow_forward_rounded,
                    bulletColor: EduColors.ink,
                  ),

                  if ((body['dataCaveats'] as List?)?.isNotEmpty ?? false) ...[
                    const SizedBox(height: 14),
                    EduCard(
                      title: 'About this report',
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          for (final caveat in (body['dataCaveats'] as List).cast<String>())
                            Padding(
                              padding: const EdgeInsets.only(bottom: 6),
                              child: Text(caveat, style: EduText.bodySm),
                            ),
                        ],
                      ),
                    ),
                  ],

                  const SizedBox(height: 14),
                  Text(
                    'Written by ${report['model'] ?? 'the EduPlus assistant'} from your recorded '
                    'attendance, marks and submissions. Your mentor reviews it too.',
                    style: EduText.bodySm.copyWith(color: EduColors.inkFaint),
                  ),
                ],
              );
            },
          );
        },
      ),
    );
  }
}

class _Section extends StatelessWidget {
  const _Section({
    required this.title,
    required this.items,
    required this.emptyNote,
    required this.bullet,
    required this.bulletColor,
  });

  final String title;
  final List<String> items;
  final String emptyNote;
  final IconData bullet;
  final Color bulletColor;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 14),
      child: EduCard(
        title: title,
        child: items.isEmpty
            ? Text(emptyNote, style: EduText.bodySm)
            : Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  for (final item in items)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(bullet, size: 17, color: bulletColor),
                          const SizedBox(width: 10),
                          Expanded(child: Text(item, style: EduText.body)),
                        ],
                      ),
                    ),
                ],
              ),
      ),
    );
  }
}
