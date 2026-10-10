import 'package:flutter/material.dart';

import '../data.dart';
import '../planly_api.dart';
import '../theme.dart';

/// Planly — the student talks to their planner.
///
/// Opens by greeting them with their own figures rather than an empty box.
/// Most of the students this product exists for would never type the first
/// message, so the screen has to start the conversation and offer buttons that
/// do something useful without any typing at all.
class PlanlyScreen extends StatefulWidget {
  const PlanlyScreen({super.key, required this.data});

  final StudentData data;

  @override
  State<PlanlyScreen> createState() => _PlanlyScreenState();
}

class _PlanlyScreenState extends State<PlanlyScreen> {
  final _api = PlanlyApi();
  final _input = TextEditingController();
  final _scroll = ScrollController();

  final List<PlanlyMessage> _history = [];
  bool _busy = false;
  String? _error;
  String _working = '';

  @override
  void initState() {
    super.initState();
    _open();
  }

  @override
  void dispose() {
    _input.dispose();
    _scroll.dispose();
    super.dispose();
  }

  void _toBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (_scroll.hasClients) {
        _scroll.animateTo(
          _scroll.position.maxScrollExtent,
          duration: const Duration(milliseconds: 220),
          curve: Curves.easeOut,
        );
      }
    });
  }

  Future<void> _open() async {
    setState(() {
      _busy = true;
      _error = null;
      _working = 'Reading your results…';
    });
    try {
      final reply = await _api.chat(const []);
      if (!mounted) return;
      setState(() => _history.add(PlanlyMessage(role: 'assistant', content: reply.reply)));
      _toBottom();
    } on PlanlyException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _send(String text) async {
    final message = text.trim();
    if (message.isEmpty || _busy) return;

    setState(() {
      _history.add(PlanlyMessage(role: 'user', content: message));
      _busy = true;
      _error = null;
      _working = 'Thinking…';
    });
    _input.clear();
    _toBottom();

    try {
      final reply = await _api.chat(_history);
      if (!mounted) return;
      setState(() => _history.add(PlanlyMessage(role: 'assistant', content: reply.reply)));
      _toBottom();
      if (reply.changedPlan && mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Your plan and calendar have been updated.')),
        );
      }
    } on PlanlyException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _makePlan(int weeks) async {
    setState(() {
      _busy = true;
      _error = null;
      _working = 'Building your plan — this takes a moment…';
      _history.add(PlanlyMessage(role: 'user', content: 'Make me a $weeks-week plan.'));
    });
    _toBottom();

    try {
      final reply = await _api.makePlan(weeks: weeks);
      if (!mounted) return;
      setState(() => _history.add(PlanlyMessage(role: 'assistant', content: reply.reply)));
      _toBottom();
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Plan saved. Check Schedule for today’s tasks.')),
        );
      }
    } on PlanlyException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final canGoBack = Navigator.of(context).canPop();

    // As a tab, this screen sits inside a Scaffold with extendBody: true, so
    // the body runs UNDERNEATH the floating pill nav and the composer ends up
    // hidden behind it. Pushed as its own route there is no nav to clear.
    final navClearance = canGoBack ? 0.0 : 78.0;

    return Scaffold(
      backgroundColor: EduColors.canvas,
      appBar: AppBar(
        title: const Text('Planly'),
        // Shown when Planly was pushed from somewhere (e.g. Schedule). As a
        // bottom-nav tab there is nothing to pop, so no dead arrow appears.
        leading: canGoBack
            ? IconButton(
                tooltip: 'Back',
                icon: const Icon(Icons.arrow_back_rounded, color: EduColors.ink),
                onPressed: () => Navigator.of(context).pop(),
              )
            : null,
        automaticallyImplyLeading: false,
      ),
      body: Column(
        children: [
          Expanded(
            child: ListView(
              controller: _scroll,
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 8),
              children: [
                for (final message in _history)
                  Align(
                    alignment: message.role == 'user'
                        ? Alignment.centerRight
                        : Alignment.centerLeft,
                    child: Container(
                      constraints: BoxConstraints(
                        maxWidth: MediaQuery.of(context).size.width * 0.82,
                      ),
                      margin: const EdgeInsets.only(bottom: 10),
                      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 11),
                      decoration: BoxDecoration(
                        color: message.role == 'user' ? EduColors.ink : EduColors.surface,
                        borderRadius: BorderRadius.circular(EduRadius.card),
                        border: Border.all(
                          color: message.role == 'user'
                              ? EduColors.ink
                              : EduColors.hairline,
                        ),
                      ),
                      child: Text(
                        message.content,
                        style: EduText.body.copyWith(
                          color: message.role == 'user' ? EduColors.canvas : EduColors.ink,
                        ),
                      ),
                    ),
                  ),

                if (_busy)
                  Padding(
                    padding: const EdgeInsets.only(bottom: 10),
                    child: Row(
                      children: [
                        const SizedBox(
                          width: 14,
                          height: 14,
                          child: CircularProgressIndicator(
                            strokeWidth: 2,
                            color: EduColors.inkFaint,
                          ),
                        ),
                        const SizedBox(width: 10),
                        Expanded(child: Text(_working, style: EduText.bodySm)),
                      ],
                    ),
                  ),

                if (_error != null)
                  Container(
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
                    decoration: BoxDecoration(
                      color: EduColors.fillFor('critical'),
                      borderRadius: BorderRadius.circular(EduRadius.control),
                    ),
                    child: Text(
                      _error!,
                      style: TextStyle(color: EduColors.textFor('critical'), fontSize: 13.5),
                    ),
                  ),
              ],
            ),
          ),

          // Starters, so the screen is useful without typing anything.
          if (_history.length <= 1 && !_busy)
            SizedBox(
              height: 44,
              child: ListView(
                scrollDirection: Axis.horizontal,
                padding: const EdgeInsets.symmetric(horizontal: 16),
                children: [
                  _Chip(label: 'Make me a 2-week plan', onTap: () => _makePlan(2)),
                  _Chip(label: 'What should I do today?', onTap: () => _send('What should I do today?')),
                  _Chip(
                    label: 'Give me practice on my weakest subject',
                    onTap: () => _send('Give me some practice on my weakest subject.'),
                  ),
                  _Chip(
                    label: 'Why is my score where it is?',
                    onTap: () => _send('Why is my score where it is?'),
                  ),
                ],
              ),
            ),

          Container(
            padding: EdgeInsets.fromLTRB(
              16,
              10,
              16,
              // With the keyboard up, viewInsets already lifts the composer and
              // the nav bar is hidden, so the clearance is only needed when the
              // keyboard is down.
              10 +
                  (MediaQuery.of(context).viewInsets.bottom > 0
                      ? 0
                      : navClearance + MediaQuery.of(context).viewPadding.bottom),
            ),
            decoration: const BoxDecoration(
              color: EduColors.surface,
              border: Border(top: BorderSide(color: EduColors.hairline)),
            ),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Expanded(
                  child: TextField(
                    controller: _input,
                    minLines: 1,
                    maxLines: 4,
                    textInputAction: TextInputAction.send,
                    onSubmitted: _send,
                    decoration: const InputDecoration(
                      hintText: 'Ask Planly…',
                      isDense: true,
                    ),
                  ),
                ),
                const SizedBox(width: 10),
                SizedBox(
                  height: 48,
                  child: FilledButton(
                    onPressed: _busy ? null : () => _send(_input.text),
                    style: FilledButton.styleFrom(
                      minimumSize: const Size(64, 48),
                      backgroundColor: EduColors.ink,
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(EduRadius.control),
                      ),
                    ),
                    child: const Icon(Icons.arrow_upward_rounded, size: 20),
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

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.onTap});

  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 8),
      child: ActionChip(
        label: Text(label, style: const TextStyle(fontSize: 13)),
        onPressed: onTap,
        backgroundColor: EduColors.surface,
        side: const BorderSide(color: EduColors.hairline),
        shape: const StadiumBorder(),
      ),
    );
  }
}
