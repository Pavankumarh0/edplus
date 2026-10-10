import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;

import '../planly_api.dart';
import '../theme.dart';
import '../widgets.dart';

/// What Planly can and cannot do, read live from the server.
///
/// Not a static list. The server builds it from the same tool registry and the
/// same allow-list that the permission layer enforces, so if a mentor switches
/// a tool off on the faculty Connectors page it disappears from here too. A
/// screen that told a student "Planly can read your attendance" while that had
/// been switched off would be lying to the person with the most at stake.
class ConnectionsScreen extends StatefulWidget {
  const ConnectionsScreen({super.key});

  @override
  State<ConnectionsScreen> createState() => _ConnectionsScreenState();
}

class _ConnectionsScreenState extends State<ConnectionsScreen> {
  List<Map<String, dynamic>>? _tools;
  List<String> _limits = const [];
  int _upcomingMeetings = 0;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final user = FirebaseAuth.instance.currentUser;
      if (user == null) throw PlanlyException('You are signed out. Sign in again.');
      final token = await user.getIdToken();

      final base = PlanlyApi().baseUrl;
      final response = await http
          .get(
            Uri.parse('$base/api/connectors/student'),
            headers: {
              'authorization': 'Bearer $token',
              'ngrok-skip-browser-warning': 'true',
            },
          )
          .timeout(const Duration(seconds: 30));

      final json = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode >= 400) {
        throw PlanlyException((json['error'] as String?) ?? 'Could not load connections.');
      }

      if (!mounted) return;
      setState(() {
        _tools = ((json['tools'] as List?) ?? []).cast<Map<String, dynamic>>();
        _limits = ((json['limits'] as List?) ?? []).cast<String>();
        _upcomingMeetings =
            ((json['meetings'] as Map?)?['upcoming'] as int?) ?? 0;
      });
    } catch (caught) {
      if (!mounted) return;
      setState(() => _error = caught is PlanlyException
          ? caught.message
          : 'Could not reach EduPlus. Check your connection.');
    }
  }

  @override
  Widget build(BuildContext context) {
    final tools = _tools;
    final enabled = tools?.where((t) => t['enabled'] == true).toList() ?? const [];
    final off = tools?.where((t) => t['enabled'] != true).toList() ?? const [];

    return Scaffold(
      backgroundColor: EduColors.canvas,
      appBar: AppBar(
        title: const Text('Connections'),
        leading: Navigator.of(context).canPop()
            ? IconButton(
                icon: const Icon(Icons.arrow_back_rounded, color: EduColors.ink),
                onPressed: () => Navigator.of(context).pop(),
              )
            : null,
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        color: EduColors.ink,
        child: ListView(
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
          children: [
            const Text(
              'Planly is an assistant with a fixed list of things it is allowed to do. '
              'This is that list, and it is the same one the college enforces.',
              style: TextStyle(fontSize: 14, color: EduColors.inkMuted, height: 1.5),
            ),
            const SizedBox(height: 18),

            if (_error != null) ...[
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: EduColors.levelFill['critical'],
                  borderRadius: BorderRadius.circular(EduRadius.control),
                ),
                child: Text(
                  _error!,
                  style: TextStyle(fontSize: 13.5, color: EduColors.levelText['critical']),
                ),
              ),
              const SizedBox(height: 14),
              OutlinedButton(onPressed: _load, child: const Text('Try again')),
            ] else if (tools == null) ...[
              const Center(child: CircularProgressIndicator(color: EduColors.ink)),
            ] else ...[
              EduCard(
                title: 'Planly',
                hint: '${enabled.length} of ${tools.length} on',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final tool in enabled) _ToolLine(tool: tool, on: true),
                    if (off.isNotEmpty) ...[
                      const SizedBox(height: 10),
                      const Text(
                        'Switched off by your college',
                        style: TextStyle(
                          fontSize: 12.5,
                          fontWeight: FontWeight.w600,
                          color: EduColors.inkFaint,
                        ),
                      ),
                      const SizedBox(height: 6),
                      for (final tool in off) _ToolLine(tool: tool, on: false),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 14),

              EduCard(
                title: 'Meetings',
                hint: _upcomingMeetings > 0 ? '$_upcomingMeetings coming up' : null,
                child: Text(
                  _upcomingMeetings > 0
                      ? 'Your mentor has booked time with you. The join link is on your '
                          'schedule, and it opens ten minutes before the start.'
                      : 'Nothing booked. Your mentor sets these up — Planly cannot.',
                  style: const TextStyle(
                    fontSize: 13.5,
                    color: EduColors.inkMuted,
                    height: 1.5,
                  ),
                ),
              ),
              const SizedBox(height: 14),

              EduCard(
                title: 'What Planly cannot do',
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final limit in _limits)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 8),
                        child: Row(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            const Icon(Icons.block_rounded,
                                size: 16, color: EduColors.inkFaint),
                            const SizedBox(width: 10),
                            Expanded(
                              child: Text(
                                limit,
                                style: const TextStyle(
                                  fontSize: 13.5,
                                  color: EduColors.inkMuted,
                                  height: 1.45,
                                ),
                              ),
                            ),
                          ],
                        ),
                      ),
                  ],
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class _ToolLine extends StatelessWidget {
  const _ToolLine({required this.tool, required this.on});

  final Map<String, dynamic> tool;
  final bool on;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            on ? Icons.check_rounded : Icons.remove_rounded,
            size: 16,
            color: on ? EduColors.levelText['stable'] : EduColors.inkFaint,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  (tool['title'] ?? tool['name']) as String,
                  style: TextStyle(
                    fontSize: 14,
                    fontWeight: FontWeight.w600,
                    color: on ? EduColors.ink : EduColors.inkFaint,
                    decoration: on ? null : TextDecoration.lineThrough,
                  ),
                ),
                const SizedBox(height: 2),
                Text(
                  (tool['description'] ?? '') as String,
                  style: const TextStyle(
                    fontSize: 13,
                    color: EduColors.inkMuted,
                    height: 1.45,
                  ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
