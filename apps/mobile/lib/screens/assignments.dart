import 'package:flutter/material.dart';
import 'package:mobile_scanner/mobile_scanner.dart';

import '../assignments_api.dart';
import '../planly_api.dart' show PlanlyException;
import '../theme.dart';
import '../widgets.dart';

/// My Assignments.
///
/// Status words come from the server, not from this device's clock. A phone
/// that thinks it is yesterday still shows "submitted late" if that is what
/// the server recorded, which is the only version that can be trusted.
class AssignmentsScreen extends StatefulWidget {
  const AssignmentsScreen({super.key});

  @override
  State<AssignmentsScreen> createState() => _AssignmentsScreenState();
}

class _AssignmentsScreenState extends State<AssignmentsScreen> {
  final _api = AssignmentsApi();
  final _exit = ExitApi();
  List<Map<String, dynamic>>? _assignments;
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    try {
      final list = await _api.list();
      if (!mounted) return;
      setState(() {
        _assignments = list;
        _error = null;
      });
    } catch (caught) {
      if (!mounted) return;
      setState(() => _error =
          caught is PlanlyException ? caught.message : 'Could not load assignments.');
    }
  }

  Future<void> _openCode(String code) async {
    setState(() => _busy = true);
    try {
      final assignment = await _api.resolve(code);
      if (!mounted) return;
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          builder: (_) => AssignmentDetailScreen(assignment: assignment, api: _api),
        ),
      );
      await _load();
    } catch (caught) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(caught is PlanlyException ? caught.message : 'Could not open that code.'),
          backgroundColor: EduColors.ink,
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }


  /// Scan the rotating code a mentor shows at the end of a session.
  ///
  /// Nothing about the result is decided here. The app sends what it read and
  /// shows what it is told — a phone cannot talk itself into a verification.
  Future<void> _scanExit() async {
    final payload = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const _ScannerScreen()),
    );
    if (payload == null || payload.isEmpty) return;

    setState(() => _busy = true);
    try {
      final result = await _exit.verify(payload);
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          backgroundColor: EduColors.surface,
          icon: Icon(
            result.repeat ? Icons.check_circle_outline_rounded : Icons.check_circle_rounded,
            color: EduColors.levelText['stable'],
            size: 40,
          ),
          title: Text(result.repeat ? 'Already signed out' : 'Signed out'),
          content: Text(result.message, textAlign: TextAlign.center),
          actions: [
            FilledButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Done'),
            ),
          ],
        ),
      );
    } catch (caught) {
      if (!mounted) return;
      await showDialog<void>(
        context: context,
        builder: (dialogContext) => AlertDialog(
          backgroundColor: EduColors.surface,
          icon: Icon(
            Icons.error_outline_rounded,
            color: EduColors.levelText['critical'],
            size: 40,
          ),
          title: const Text('Not recorded'),
          content: Text(
            caught is PlanlyException ? caught.message : 'That code was not accepted.',
            textAlign: TextAlign.center,
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogContext).pop(),
              child: const Text('Close'),
            ),
            FilledButton(
              onPressed: () {
                Navigator.of(dialogContext).pop();
                _scanExit();
              },
              child: const Text('Scan again'),
            ),
          ],
        ),
      );
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _scan() async {
    final code = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => const _ScannerScreen()),
    );
    if (code != null && code.isNotEmpty) await _openCode(code);
  }

  Future<void> _typeCode() async {
    final controller = TextEditingController();
    final code = await showDialog<String>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        backgroundColor: EduColors.surface,
        title: const Text('Enter the code'),
        content: TextField(
          controller: controller,
          autofocus: true,
          textCapitalization: TextCapitalization.characters,
          decoration: const InputDecoration(
            labelText: 'Six characters',
            hintText: 'e.g. K7M2QP',
          ),
          onSubmitted: (value) => Navigator.of(dialogContext).pop(value),
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(dialogContext).pop(),
            child: const Text('Cancel'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(dialogContext).pop(controller.text),
            child: const Text('Open'),
          ),
        ],
      ),
    );
    if (code != null && code.trim().isNotEmpty) await _openCode(code.trim());
  }

  @override
  Widget build(BuildContext context) {
    final assignments = _assignments;

    return Scaffold(
      backgroundColor: EduColors.canvas,
      appBar: AppBar(
        title: const Text('Assignments'),
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
          padding: const EdgeInsets.fromLTRB(20, 8, 20, 110),
          children: [
            Row(
              children: [
                Expanded(
                  child: FilledButton.icon(
                    onPressed: _busy ? null : _scan,
                    icon: const Icon(Icons.qr_code_scanner_rounded, size: 18),
                    label: const Text('Scan QR'),
                    style: FilledButton.styleFrom(
                      backgroundColor: EduColors.ink,
                      foregroundColor: EduColors.canvas,
                      minimumSize: const Size.fromHeight(48),
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: OutlinedButton.icon(
                    onPressed: _busy ? null : _typeCode,
                    icon: const Icon(Icons.keyboard_rounded, size: 18),
                    label: const Text('Type code'),
                    style: OutlinedButton.styleFrom(
                      foregroundColor: EduColors.ink,
                      side: const BorderSide(color: EduColors.hairline),
                      minimumSize: const Size.fromHeight(48),
                    ),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 10),
            OutlinedButton.icon(
              onPressed: _busy ? null : _scanExit,
              icon: const Icon(Icons.logout_rounded, size: 18),
              label: const Text('Scan exit code'),
              style: OutlinedButton.styleFrom(
                foregroundColor: EduColors.ink,
                side: const BorderSide(color: EduColors.hairline),
                minimumSize: const Size.fromHeight(44),
              ),
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
            ] else if (assignments == null)
              const Center(child: CircularProgressIndicator(color: EduColors.ink))
            else if (assignments.isEmpty)
              const EduEmpty(
                title: 'No assignments yet',
                body: 'When your mentor sets one, scan the code on the board to open it.',
              )
            else
              for (final assignment in assignments)
                Padding(
                  padding: const EdgeInsets.only(bottom: 12),
                  child: _AssignmentCard(
                    assignment: assignment,
                    onOpen: () async {
                      await Navigator.of(context).push(
                        MaterialPageRoute<void>(
                          builder: (_) =>
                              AssignmentDetailScreen(assignment: assignment, api: _api),
                        ),
                      );
                      await _load();
                    },
                  ),
                ),
          ],
        ),
      ),
    );
  }
}

/// Status colours. Overdue is the only one that reads as a warning: a late
/// submission is work that got done, which is not the same thing as nothing.
({Color fg, Color bg, String label}) _stateTone(String state) {
  switch (state) {
    case 'submitted_on_time':
      return (
        fg: EduColors.levelText['stable']!,
        bg: EduColors.levelFill['stable']!,
        label: 'Submitted',
      );
    case 'submitted_late':
      return (
        fg: EduColors.levelText['watch']!,
        bg: EduColors.levelFill['watch']!,
        label: 'Submitted late',
      );
    case 'overdue':
      return (
        fg: EduColors.levelText['critical']!,
        bg: EduColors.levelFill['critical']!,
        label: 'Overdue',
      );
    default:
      return (fg: EduColors.inkMuted, bg: EduColors.sunk, label: 'Not started');
  }
}

class _AssignmentCard extends StatelessWidget {
  const _AssignmentCard({required this.assignment, required this.onOpen});

  final Map<String, dynamic> assignment;
  final Future<void> Function() onOpen;

  @override
  Widget build(BuildContext context) {
    final tone = _stateTone((assignment['state'] ?? 'not_started') as String);

    return GestureDetector(
      onTap: () => onOpen(),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: EduColors.surface,
          borderRadius: BorderRadius.circular(EduRadius.card),
          border: Border.all(color: EduColors.hairline),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(
                    (assignment['title'] ?? '') as String,
                    style: const TextStyle(
                      fontSize: 15.5,
                      fontWeight: FontWeight.w600,
                      color: EduColors.ink,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
                  decoration: BoxDecoration(
                    color: tone.bg,
                    borderRadius: BorderRadius.circular(EduRadius.pill),
                  ),
                  child: Text(
                    tone.label,
                    style: TextStyle(fontSize: 12, fontWeight: FontWeight.w600, color: tone.fg),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              '${assignment['subject']} · ${assignment['facultyName']}',
              style: const TextStyle(fontSize: 13, color: EduColors.inkMuted),
            ),
            const SizedBox(height: 10),
            Text(
              (assignment['remaining'] ?? '') as String,
              style: TextStyle(
                fontSize: 13,
                fontWeight: FontWeight.w600,
                color: assignment['overdue'] == true
                    ? EduColors.levelText['critical']
                    : EduColors.inkMuted,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/// The scanner. Camera permission is requested by the plugin on first open;
/// if it is refused there is always the typed code on the previous screen.
class _ScannerScreen extends StatefulWidget {
  const _ScannerScreen();

  @override
  State<_ScannerScreen> createState() => _ScannerScreenState();
}

class _ScannerScreenState extends State<_ScannerScreen> {
  bool _handled = false;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: EduColors.ink,
      appBar: AppBar(
        backgroundColor: EduColors.ink,
        foregroundColor: EduColors.canvas,
        title: const Text('Scan the code'),
        leading: IconButton(
          icon: const Icon(Icons.close_rounded, color: EduColors.canvas),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: Stack(
        children: [
          MobileScanner(
            onDetect: (capture) {
              // Fires repeatedly while the code is in frame; take the first.
              if (_handled) return;
              final value = capture.barcodes.firstOrNull?.rawValue;
              if (value == null || value.isEmpty) return;
              _handled = true;
              Navigator.of(context).pop(value);
            },
            errorBuilder: (context, error, child) => Center(
              child: Padding(
                padding: const EdgeInsets.all(32),
                child: Text(
                  'The camera is not available.\n\nGo back and use "Type code" instead — '
                  'the six characters are on the board.',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: EduColors.canvas.withValues(alpha: 0.85), height: 1.5),
                ),
              ),
            ),
          ),
          Align(
            alignment: Alignment.bottomCenter,
            child: Padding(
              padding: const EdgeInsets.all(28),
              child: Text(
                'Point at the QR your mentor is showing',
                textAlign: TextAlign.center,
                style: TextStyle(color: EduColors.canvas.withValues(alpha: 0.8), fontSize: 14),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────

/// One assignment: what to do, when it is due, and the box to do it in.
class AssignmentDetailScreen extends StatefulWidget {
  const AssignmentDetailScreen({super.key, required this.assignment, required this.api});

  final Map<String, dynamic> assignment;
  final AssignmentsApi api;

  @override
  State<AssignmentDetailScreen> createState() => _AssignmentDetailScreenState();
}

class _AssignmentDetailScreenState extends State<AssignmentDetailScreen> {
  late Map<String, dynamic> _assignment = widget.assignment;
  late final TextEditingController _content = TextEditingController(
    text: (_assignment['submission'] as Map<String, dynamic>?)?['content'] as String? ?? '',
  );
  bool _busy = false;
  String? _error;
  String? _done;

  @override
  void dispose() {
    _content.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _busy = true;
      _error = null;
      _done = null;
    });
    try {
      final result = await widget.api.submit(
        assignmentId: _assignment['assignmentId'] as String,
        content: _content.text.trim(),
      );
      if (!mounted) return;
      setState(() {
        _assignment = result.assignment;
        _done = result.message;
      });
    } catch (caught) {
      if (!mounted) return;
      setState(() =>
          _error = caught is PlanlyException ? caught.message : 'Could not submit.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final submission = _assignment['submission'] as Map<String, dynamic>?;
    final tone = _stateTone((_assignment['state'] ?? 'not_started') as String);
    final overdue = _assignment['overdue'] == true;
    final acceptLate = _assignment['acceptLate'] == true;
    final canSubmit = !overdue || acceptLate;

    return Scaffold(
      backgroundColor: EduColors.canvas,
      appBar: AppBar(
        title: const Text('Assignment'),
        leading: IconButton(
          icon: const Icon(Icons.arrow_back_rounded, color: EduColors.ink),
          onPressed: () => Navigator.of(context).pop(),
        ),
      ),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 8, 20, 40),
        children: [
          Text(
            (_assignment['title'] ?? '') as String,
            style: const TextStyle(
              fontSize: 21,
              fontWeight: FontWeight.w600,
              color: EduColors.ink,
              height: 1.25,
            ),
          ),
          const SizedBox(height: 6),
          Text(
            '${_assignment['subject']} · set by ${_assignment['facultyName']}',
            style: const TextStyle(fontSize: 13.5, color: EduColors.inkMuted),
          ),
          const SizedBox(height: 14),

          Row(
            children: [
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
                decoration: BoxDecoration(
                  color: tone.bg,
                  borderRadius: BorderRadius.circular(EduRadius.pill),
                ),
                child: Text(
                  tone.label,
                  style: TextStyle(fontSize: 12.5, fontWeight: FontWeight.w600, color: tone.fg),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: Text(
                  (_assignment['remaining'] ?? '') as String,
                  style: TextStyle(
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    color: overdue ? EduColors.levelText['critical'] : EduColors.inkMuted,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 18),

          EduCard(
            title: 'What to do',
            child: Text(
              (_assignment['instructions'] ?? '') as String,
              style: const TextStyle(fontSize: 14, color: EduColors.inkMuted, height: 1.55),
            ),
          ),
          const SizedBox(height: 14),

          EduCard(
            title: submission == null ? 'Your answer' : 'Your answer (you can replace it)',
            hint: _assignment['maxMarks'] != null ? '${_assignment['maxMarks']} marks' : null,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                TextField(
                  controller: _content,
                  maxLines: 8,
                  minLines: 5,
                  enabled: canSubmit && !_busy,
                  decoration: const InputDecoration(
                    hintText: 'Type your answer, or paste a link to your work.',
                    border: OutlineInputBorder(),
                  ),
                ),
                const SizedBox(height: 14),

                if (!canSubmit)
                  Text(
                    'The deadline has passed and this assignment does not take late work. '
                    'Your work is not lost — talk to your mentor.',
                    style: TextStyle(
                      fontSize: 13,
                      color: EduColors.levelText['critical'],
                      height: 1.45,
                    ),
                  )
                else ...[
                  if (overdue)
                    Padding(
                      padding: const EdgeInsets.only(bottom: 12),
                      child: Text(
                        'The deadline has passed. You can still submit; it will be recorded '
                        'as late.',
                        style: TextStyle(
                          fontSize: 13,
                          color: EduColors.levelText['watch'],
                          height: 1.45,
                        ),
                      ),
                    ),
                  FilledButton(
                    onPressed: _busy || _content.text.trim().isEmpty ? null : _submit,
                    style: FilledButton.styleFrom(
                      backgroundColor: EduColors.ink,
                      foregroundColor: EduColors.canvas,
                      minimumSize: const Size.fromHeight(48),
                    ),
                    child: Text(
                      _busy
                          ? 'Submitting…'
                          : submission == null
                              ? 'Submit'
                              : 'Replace my answer',
                    ),
                  ),
                ],

                if (_done != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: EduColors.levelFill['stable'],
                      borderRadius: BorderRadius.circular(EduRadius.control),
                    ),
                    child: Text(
                      _done!,
                      style: TextStyle(fontSize: 13, color: EduColors.levelText['stable']),
                    ),
                  ),
                ],
                if (_error != null) ...[
                  const SizedBox(height: 12),
                  Container(
                    width: double.infinity,
                    padding: const EdgeInsets.all(12),
                    decoration: BoxDecoration(
                      color: EduColors.levelFill['critical'],
                      borderRadius: BorderRadius.circular(EduRadius.control),
                    ),
                    child: Text(
                      _error!,
                      style: TextStyle(fontSize: 13, color: EduColors.levelText['critical']),
                    ),
                  ),
                ],
              ],
            ),
          ),

          if (submission != null) ...[
            const SizedBox(height: 14),
            EduCard(
              title: 'Submission history',
              hint: 'attempt ${submission['version']}',
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    'Submitted ${DateTime.parse(submission['submittedAt'] as String).toLocal()}',
                    style: const TextStyle(fontSize: 13, color: EduColors.inkMuted),
                  ),
                  for (final past in ((submission['history'] as List?) ?? []))
                    Padding(
                      padding: const EdgeInsets.only(top: 8),
                      child: Text(
                        'Earlier attempt · ${past['status']}',
                        style: const TextStyle(fontSize: 12.5, color: EduColors.inkFaint),
                      ),
                    ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}
