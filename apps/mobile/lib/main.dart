import 'package:firebase_auth/firebase_auth.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:flutter/material.dart';

import 'data.dart';
import 'firebase_options.dart';
import 'app_config.dart';
import 'screens/assignments.dart';
import 'screens/home.dart';
import 'screens/login.dart';
import 'screens/planly.dart';
import 'screens/progress.dart';
import 'screens/schedule.dart';
import 'theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Options passed explicitly rather than read from the google-services
  // resources: that resource generation is a Gradle step, so a hot restart or
  // a stale build silently leaves it missing and the app throws
  // "Failed to load FirebaseOptions from resource" at startup.
  await Firebase.initializeApp(
    options: DefaultFirebaseOptions.currentPlatform,
  );
  // Where the server is, read from Firestore so a changed tunnel URL needs a
  // reopen rather than a rebuild. Awaited but never fatal — a failure here
  // only affects Planly, and the rest of the app reads Firestore directly.
  await AppConfig.refresh();

  runApp(const EduPlusApp());
}

class EduPlusApp extends StatelessWidget {
  const EduPlusApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'EduPlus',
      debugShowCheckedModeBanner: false,
      theme: buildTheme(),
      home: const AuthGate(),
    );
  }
}

/// Decides between the login screen and the app.
///
/// A signed-in user still needs a `usn` claim — a Firebase account alone does
/// not make someone a student of this college, and without the claim the
/// security rules would deny every read anyway. Saying so plainly beats
/// showing an app full of permission errors.
class AuthGate extends StatelessWidget {
  const AuthGate({super.key});

  @override
  Widget build(BuildContext context) {
    return StreamBuilder<User?>(
      stream: FirebaseAuth.instance.authStateChanges(),
      builder: (context, snapshot) {
        if (snapshot.connectionState == ConnectionState.waiting) {
          return const _Splash();
        }
        if (snapshot.data == null) return const LoginScreen();

        return FutureBuilder<List<String?>>(
          future: Future.wait([
            StudentData.currentUsn(refresh: true),
            StudentData.currentRole(),
            // Re-read here, not only at startup: the security rules allow
            // config/* to a signed-in user, and at startup nobody is signed in
            // yet, so the first attempt is always denied.
            AppConfig.refresh().then((_) => null),
          ]),
          builder: (context, claims) {
            if (claims.connectionState == ConnectionState.waiting) {
              return const _Splash();
            }

            final usn = claims.data?[0];
            final role = claims.data?[1];

            if (usn == null || role != 'student') {
              return _NoAccess(email: snapshot.data!.email ?? '', role: role);
            }

            return StudentShell(usn: usn);
          },
        );
      },
    );
  }
}

class _Splash extends StatelessWidget {
  const _Splash();

  @override
  Widget build(BuildContext context) => const Scaffold(
        body: Center(child: CircularProgressIndicator(color: EduColors.ink)),
      );
}

class _NoAccess extends StatelessWidget {
  const _NoAccess({required this.email, required this.role});

  final String email;
  final String? role;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Center(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Text('This app is for students', style: EduText.h1, textAlign: TextAlign.center),
              const SizedBox(height: 10),
              Text(
                role == 'faculty'
                    ? 'You are signed in as faculty. Use the EduPlus dashboard in a browser.'
                    : 'Your account ($email) is not linked to a student record yet. Ask your '
                        'department office to link it to your USN.',
                style: EduText.bodySm,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: () => FirebaseAuth.instance.signOut(),
                child: const Text('Sign out'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// The four student screens behind a floating pill bottom nav.
class StudentShell extends StatefulWidget {
  const StudentShell({super.key, required this.usn});

  final String usn;

  @override
  State<StudentShell> createState() => _StudentShellState();
}

class _StudentShellState extends State<StudentShell> {
  int _index = 0;

  // Schedule replaces the old Tasks tab: it shows the same tasks, but on the
  // day they are meant to be done, which is the question a student actually
  // has. Planly gets its own tab because it is the thing that fills it.
  static const _tabs = [
    (icon: Icons.home_rounded, label: 'Home'),
    (icon: Icons.calendar_today_rounded, label: 'Schedule'),
    (icon: Icons.assignment_rounded, label: 'Assignments'),
    (icon: Icons.auto_awesome_rounded, label: 'Planly'),
    (icon: Icons.show_chart_rounded, label: 'Progress'),
  ];

  @override
  Widget build(BuildContext context) {
    final data = StudentData(widget.usn);

    final screens = [
      HomeScreen(data: data),
      ScheduleScreen(data: data),
      const AssignmentsScreen(),
      PlanlyScreen(data: data),
      ProgressScreen(data: data),
    ];

    return Scaffold(
      body: IndexedStack(index: _index, children: screens),
      extendBody: true,
      bottomNavigationBar: SafeArea(
        child: Container(
          margin: const EdgeInsets.fromLTRB(20, 0, 20, 14),
          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 6),
          decoration: BoxDecoration(
            color: EduColors.ink,
            borderRadius: BorderRadius.circular(EduRadius.pill),
            boxShadow: [
              BoxShadow(
                color: EduColors.ink.withValues(alpha: 0.18),
                blurRadius: 24,
                offset: const Offset(0, 8),
              ),
            ],
          ),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: List.generate(_tabs.length, (index) {
              final selected = index == _index;
              return Expanded(
                child: Semantics(
                  selected: selected,
                  button: true,
                  label: _tabs[index].label,
                  child: GestureDetector(
                    onTap: () => setState(() => _index = index),
                    behavior: HitTestBehavior.opaque,
                    child: AnimatedContainer(
                      duration: const Duration(milliseconds: 180),
                      curve: Curves.easeOutCubic,
                      height: 48,
                      decoration: BoxDecoration(
                        color: selected ? EduColors.lime : Colors.transparent,
                        borderRadius: BorderRadius.circular(EduRadius.pill),
                      ),
                      // Icon only. The label still reaches a screen reader
                      // through the Semantics wrapper above, so dropping the
                      // visible text costs nothing in accessibility.
                      child: Center(
                        child: Icon(
                          _tabs[index].icon,
                          size: 22,
                          color: selected
                              ? EduColors.ink
                              : EduColors.canvas.withValues(alpha: 0.7),
                        ),
                      ),
                    ),
                  ),
                ),
              );
            }),
          ),
        ),
      ),
    );
  }
}
