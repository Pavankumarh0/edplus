import 'package:firebase_auth/firebase_auth.dart';
import 'package:flutter/material.dart';
import '../theme.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _signIn() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    try {
      await FirebaseAuth.instance.signInWithEmailAndPassword(
        email: _email.text.trim(),
        password: _password.text,
      );
      // AuthGate takes over from here.
    } on FirebaseAuthException catch (error) {
      setState(() => _error = _describe(error.code));
    } catch (_) {
      setState(() => _error = 'Could not sign in. Try again.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  /// Firebase error codes, translated into something a student can act on.
  String _describe(String code) {
    switch (code) {
      case 'invalid-credential':
      case 'wrong-password':
      case 'user-not-found':
        return 'That email and password do not match an account.';
      case 'invalid-email':
        return 'That does not look like an email address.';
      case 'too-many-requests':
        return 'Too many attempts. Wait a minute and try again.';
      case 'network-request-failed':
        return 'No connection. Check your network and try again.';
      default:
        return 'Could not sign in. Try again.';
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const SizedBox(height: 32),
              Container(
                width: 44,
                height: 44,
                decoration: BoxDecoration(
                  color: EduColors.ink,
                  borderRadius: BorderRadius.circular(EduRadius.control),
                ),
                child: const Center(
                  child: Text(
                    'E',
                    style: TextStyle(
                      color: EduColors.lime,
                      fontSize: 20,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 22),
              const Text('EduPlus', style: EduText.display),
              const SizedBox(height: 10),
              const Text(
                'Your attendance, your marks, and what to do next — in one place.',
                style: EduText.body,
              ),
              const SizedBox(height: 34),

              TextField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.username],
                decoration: const InputDecoration(labelText: 'College email'),
              ),
              const SizedBox(height: 14),
              TextField(
                controller: _password,
                obscureText: true,
                autofillHints: const [AutofillHints.password],
                onSubmitted: (_) => _busy ? null : _signIn(),
                decoration: const InputDecoration(labelText: 'Password'),
              ),

              if (_error != null) ...[
                const SizedBox(height: 16),
                Container(
                  width: double.infinity,
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

              const SizedBox(height: 22),
              FilledButton(
                onPressed: _busy ? null : _signIn,
                child: Text(_busy ? 'Signing in…' : 'Sign in'),
              ),

              const SizedBox(height: 18),
              const Text(
                'Use the email your department registered for you. If you cannot sign in, '
                'ask your mentor.',
                style: EduText.bodySm,
              ),
            ],
          ),
        ),
      ),
    );
  }
}
