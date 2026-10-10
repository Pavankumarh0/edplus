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

              const _AvailableConnectors(),
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

/// The college's approved notes and calendar services.
///
/// A student picks from this list; there is no field anywhere in the app for
/// typing a server URL. That is deliberate and it is the whole of the "notes
/// and calendar only" rule: the category belongs to an entry a faculty member
/// approved, not to anything a server claims about itself, so there is no text
/// a student or a server could supply that would widen it.
class _AvailableConnectors extends StatefulWidget {
  const _AvailableConnectors();

  @override
  State<_AvailableConnectors> createState() => _AvailableConnectorsState();
}

class _AvailableConnectorsState extends State<_AvailableConnectors> {
  List<Map<String, dynamic>>? _available;
  bool _policyEnabled = true;
  String? _busy;
  String? _error;
  String? _note;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<String> _token() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw PlanlyException('You are signed out. Sign in again.');
    return (await user.getIdToken())!;
  }

  Uri _uri([String query = '']) =>
      Uri.parse('${PlanlyApi().baseUrl}/api/connectors/student/available$query');

  Map<String, String> _headers(String token) => {
        'authorization': 'Bearer $token',
        'content-type': 'application/json',
        'ngrok-skip-browser-warning': 'true',
      };

  Future<void> _load() async {
    try {
      final token = await _token();
      final response =
          await http.get(_uri(), headers: _headers(token)).timeout(const Duration(seconds: 30));
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode >= 400) {
        throw PlanlyException((json['error'] as String?) ?? 'Could not load services.');
      }
      if (!mounted) return;
      setState(() {
        _policyEnabled = json['enabled'] == true;
        _available = ((json['available'] as List?) ?? []).cast<Map<String, dynamic>>();
      });
    } catch (caught) {
      if (!mounted) return;
      setState(() => _error =
          caught is PlanlyException ? caught.message : 'Could not load services.');
    }
  }

  Future<void> _send(
    String label,
    Future<http.Response> Function(String token) run,
  ) async {
    setState(() {
      _busy = label;
      _error = null;
      _note = null;
    });
    try {
      final response = await run(await _token()).timeout(const Duration(seconds: 45));
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode >= 400) {
        throw PlanlyException((json['error'] as String?) ?? 'That did not work.');
      }
      if (!mounted) return;
      setState(() => _note = json['message'] as String?);
      await _load();
    } catch (caught) {
      if (!mounted) return;
      setState(() =>
          _error = caught is PlanlyException ? caught.message : 'That did not work.');
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final available = _available;
    if (available == null) return const SizedBox.shrink();

    if (!_policyEnabled || available.isEmpty) {
      return EduCard(
        title: 'Add a service',
        child: Text(
          _policyEnabled
              ? 'Your college has not approved any services yet. When it does, your '
                  'notes and calendar apps will appear here.'
              : 'Your college has not turned this on.',
          style: const TextStyle(fontSize: 13.5, color: EduColors.inkMuted, height: 1.5),
        ),
      );
    }

    return EduCard(
      title: 'Your services',
      hint: '${available.where((a) => a['connected'] == true).length} connected',
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'Notes and calendar apps your college has approved. Connecting one lets '
            'Planly use it when it plans your week.',
            style: TextStyle(fontSize: 13.5, color: EduColors.inkMuted, height: 1.5),
          ),
          if (_note != null) ...[
            const SizedBox(height: 12),
            _ConnectorBanner(text: _note!, level: 'stable'),
          ],
          if (_error != null) ...[
            const SizedBox(height: 12),
            _ConnectorBanner(text: _error!, level: 'critical'),
          ],
          const SizedBox(height: 6),
          for (final service in available) ...[
            const SizedBox(height: 14),
            _ServiceTile(
              service: service,
              busy: _busy,
              onConnect: () => _send(
                'connect-${service['id']}',
                (token) => http.post(
                  _uri(),
                  headers: _headers(token),
                  body: jsonEncode({'id': service['id']}),
                ),
              ),
              onDisconnect: () => _send(
                'disconnect-${service['id']}',
                (token) => http.delete(
                  _uri('?id=${Uri.encodeComponent(service['id'] as String)}'),
                  headers: _headers(token),
                ),
              ),
              onToggleTool: (tool, enabled) => _send(
                'tool-${service['id']}-$tool',
                (token) => http.patch(
                  _uri(),
                  headers: _headers(token),
                  body: jsonEncode({'id': service['id'], 'tool': tool, 'enabled': enabled}),
                ),
              ),
            ),
          ],
        ],
      ),
    );
  }
}

class _ServiceTile extends StatelessWidget {
  const _ServiceTile({
    required this.service,
    required this.busy,
    required this.onConnect,
    required this.onDisconnect,
    required this.onToggleTool,
  });

  final Map<String, dynamic> service;
  final String? busy;
  final VoidCallback onConnect;
  final VoidCallback onDisconnect;
  final void Function(String tool, bool enabled) onToggleTool;

  @override
  Widget build(BuildContext context) {
    final connected = service['connected'] == true;
    final tools = ((service['tools'] as List?) ?? []).cast<Map<String, dynamic>>();
    final category = (service['category'] ?? '') as String;

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: EduColors.canvas,
        borderRadius: BorderRadius.circular(EduRadius.control),
        border: Border.all(color: EduColors.hairline),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(
                category == 'calendar'
                    ? Icons.calendar_month_rounded
                    : Icons.sticky_note_2_rounded,
                size: 18,
                color: EduColors.ink,
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      (service['displayName'] ?? '') as String,
                      style: const TextStyle(
                        fontSize: 14.5,
                        fontWeight: FontWeight.w600,
                        color: EduColors.ink,
                      ),
                    ),
                    const SizedBox(height: 2),
                    Text(
                      (service['description'] ?? '') as String,
                      style: const TextStyle(
                        fontSize: 13,
                        color: EduColors.inkMuted,
                        height: 1.45,
                      ),
                    ),
                  ],
                ),
              ),
              const SizedBox(width: 8),
              if (connected)
                TextButton(
                  onPressed: busy == null ? onDisconnect : null,
                  child: const Text('Disconnect'),
                )
              else
                FilledButton(
                  onPressed: busy == null ? onConnect : null,
                  style: FilledButton.styleFrom(
                    backgroundColor: EduColors.lime,
                    foregroundColor: EduColors.ink,
                    padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
                  ),
                  child: Text(busy == 'connect-${service['id']}' ? '…' : 'Connect'),
                ),
            ],
          ),
          if (!connected) ...[
            const SizedBox(height: 10),
            Text(
              (service['dataNote'] ?? '') as String,
              style: const TextStyle(fontSize: 12.5, color: EduColors.inkFaint, height: 1.4),
            ),
          ],
          if (connected && tools.isNotEmpty) ...[
            const SizedBox(height: 12),
            const Text(
              'What Planly may use',
              style: TextStyle(
                fontSize: 12.5,
                fontWeight: FontWeight.w600,
                color: EduColors.inkFaint,
              ),
            ),
            for (final tool in tools)
              SwitchListTile.adaptive(
                dense: true,
                contentPadding: EdgeInsets.zero,
                value: tool['enabled'] == true,
                onChanged: busy == null
                    ? (value) => onToggleTool(tool['name'] as String, value)
                    : null,
                activeThumbColor: EduColors.ink,
                title: Text(
                  (tool['name'] ?? '') as String,
                  style: const TextStyle(fontSize: 13.5, color: EduColors.ink),
                ),
                subtitle: Text(
                  (tool['description'] ?? '') as String,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(fontSize: 12.5, color: EduColors.inkMuted),
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _ConnectorBanner extends StatelessWidget {
  const _ConnectorBanner({required this.text, required this.level});

  final String text;
  final String level;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: EduColors.levelFill[level],
        borderRadius: BorderRadius.circular(EduRadius.control),
      ),
      child: Text(
        text,
        style: TextStyle(fontSize: 13, color: EduColors.levelText[level], height: 1.45),
      ),
    );
  }
}
