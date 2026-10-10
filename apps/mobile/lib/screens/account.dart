import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';

import '../theme.dart';
import '../widgets.dart';

/// Account settings — in practice, changing the password.
///
/// Every student starts on a password their department handed them, which
/// means they all start on the same one. Letting them change it on first
/// sign-in is the difference between an account that is theirs and a shared
/// credential.
///
/// Firebase requires a recent sign-in before a password change, so the current
/// password is asked for and used to reauthenticate. That also stops someone
/// changing the password on a phone left unlocked on a desk.
class AccountScreen extends StatefulWidget {
  const AccountScreen({super.key, required this.usn});

  final String usn;

  @override
  State<AccountScreen> createState() => _AccountScreenState();
}

class _AccountScreenState extends State<AccountScreen> {
  final _current = TextEditingController();
  final _next = TextEditingController();
  final _confirm = TextEditingController();

  bool _busy = false;
  String? _error;
  String? _done;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    _confirm.dispose();
    super.dispose();
  }

  Future<void> _change() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null || user.email == null) return;

    final next = _next.text;
    if (next.length < 8) {
      setState(() => _error = 'Use at least 8 characters.');
      return;
    }
    if (next != _confirm.text) {
      setState(() => _error = 'The two new passwords do not match.');
      return;
    }
    if (next == _current.text) {
      setState(() => _error = 'That is the same as your current password.');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
      _done = null;
    });

    try {
      // Firebase refuses a password change on a stale session, so prove the
      // current password first.
      await user.reauthenticateWithCredential(
        EmailAuthProvider.credential(email: user.email!, password: _current.text),
      );
      await user.updatePassword(next);

      if (!mounted) return;
      _current.clear();
      _next.clear();
      _confirm.clear();
      setState(() => _done = 'Password changed. Use the new one next time you sign in.');
    } on FirebaseAuthException catch (error) {
      setState(() => _error = _describe(error.code));
    } catch (_) {
      setState(() => _error = 'Could not change the password. Try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _describe(String code) {
    switch (code) {
      case 'invalid-credential':
      case 'wrong-password':
        return 'Your current password is not right.';
      case 'weak-password':
        return 'That password is too easy to guess. Try a longer one.';
      case 'requires-recent-login':
        return 'For safety, sign out and sign in again before changing your password.';
      case 'network-request-failed':
        return 'No connection. Check your network and try again.';
      case 'too-many-requests':
        return 'Too many attempts. Wait a minute and try again.';
      default:
        return 'Could not change the password. Try again.';
    }
  }

  @override
  Widget build(BuildContext context) {
    final user = FirebaseAuth.instance.currentUser;

    return Scaffold(
      backgroundColor: EduColors.canvas,
      appBar: AppBar(title: const Text('Account')),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(20, 4, 20, 40),
        children: [
          EduCard(
            title: 'Signed in as',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(user?.email ?? '—', style: EduText.body),
                const SizedBox(height: 4),
                Text('USN ${widget.usn}', style: EduText.bodySm),
              ],
            ),
          ),
          const SizedBox(height: 14),

          EduCard(
            title: 'Change password',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'Your college gave everyone the same starting password. Change it to '
                  'something only you know.',
                  style: EduText.bodySm,
                ),
                const SizedBox(height: 16),

                TextField(
                  controller: _current,
                  obscureText: true,
                  autofillHints: const [AutofillHints.password],
                  decoration: const InputDecoration(labelText: 'Current password'),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _next,
                  obscureText: true,
                  autofillHints: const [AutofillHints.newPassword],
                  decoration: const InputDecoration(
                    labelText: 'New password',
                    helperText: 'At least 8 characters',
                  ),
                ),
                const SizedBox(height: 12),
                TextField(
                  controller: _confirm,
                  obscureText: true,
                  autofillHints: const [AutofillHints.newPassword],
                  onSubmitted: (_) => _busy ? null : _change(),
                  decoration: const InputDecoration(labelText: 'New password again'),
                ),

                if (_error != null) ...[
                  const SizedBox(height: 14),
                  _Banner(text: _error!, level: 'critical'),
                ],
                if (_done != null) ...[
                  const SizedBox(height: 14),
                  _Banner(text: _done!, level: 'stable'),
                ],

                const SizedBox(height: 18),
                FilledButton(
                  onPressed: _busy ? null : _change,
                  child: Text(_busy ? 'Changing…' : 'Change password'),
                ),
              ],
            ),
          ),
          const SizedBox(height: 14),

          EduCard(
            title: 'Sign out',
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text(
                  'You will need your email and password to sign back in.',
                  style: EduText.bodySm,
                ),
                const SizedBox(height: 16),
                OutlinedButton(
                  onPressed: () async {
                    await FirebaseAuth.instance.signOut();
                    if (context.mounted) Navigator.of(context).pop();
                  },
                  style: OutlinedButton.styleFrom(
                    minimumSize: const Size.fromHeight(48),
                    foregroundColor: EduColors.ink,
                    side: const BorderSide(color: EduColors.hairline),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(EduRadius.control),
                    ),
                  ),
                  child: const Text('Sign out'),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.text, required this.level});

  final String text;
  final String level;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
      decoration: BoxDecoration(
        color: EduColors.fillFor(level),
        borderRadius: BorderRadius.circular(EduRadius.control),
      ),
      child: Text(
        text,
        style: TextStyle(color: EduColors.textFor(level), fontSize: 13.5),
      ),
    );
  }
}
