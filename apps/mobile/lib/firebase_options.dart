// Firebase configuration, passed explicitly to Firebase.initializeApp().
//
// Equivalent to what `flutterfire configure` generates, written by hand
// because the FlutterFire CLI is not installed here.
//
// WHY EXPLICIT OPTIONS RATHER THAN google-services.json:
// Without options, firebase_core reads a values.xml that the
// com.google.gms.google-services Gradle plugin is supposed to generate from
// android/app/google-services.json. When that generation does not happen — a
// hot restart (which never re-runs Gradle), a stale build directory, or the
// plugin not applied — the app compiles fine and then throws at runtime:
//
//   PlatformException: Failed to load FirebaseOptions from resource.
//   Check that you have defined values.xml correctly.
//
// Passing the options directly removes that entire class of failure. The
// Gradle plugin stays wired up because other Firebase SDKs still expect it,
// but the app no longer depends on it having run.
//
// These values are public client identifiers, not secrets. Access is
// controlled by the Firestore security rules in firebase/firestore.rules.

import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart'
    show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  const DefaultFirebaseOptions._();

  static FirebaseOptions get currentPlatform {
    if (kIsWeb) return web;

    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
      case TargetPlatform.macOS:
        throw UnsupportedError(
          'EduPlus has not been configured for Apple platforms yet. '
          'Run `flutterfire configure` to add them.',
        );
      default:
        throw UnsupportedError(
          'EduPlus is not configured for $defaultTargetPlatform.',
        );
    }
  }

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyA1BW9bPpk6rU0U3fMF8uCoI3yXZ50YdMs',
    appId: '1:183171663055:android:78d0f5dafbfb6678ba23ba',
    messagingSenderId: '183171663055',
    projectId: 'eduplus-ai-cbc2',
    storageBucket: 'eduplus-ai-cbc2.firebasestorage.app',
  );

  /// Included so `flutter run -d chrome` works for a quick look without an
  /// emulator or a device.
  static const FirebaseOptions web = FirebaseOptions(
    apiKey: 'AIzaSyBpuJgudJtWHsLrfPGHjmRUpAfEa1O5GWA',
    appId: '1:183171663055:web:c8ec9d6c6559eab5ba23ba',
    messagingSenderId: '183171663055',
    projectId: 'eduplus-ai-cbc2',
    authDomain: 'eduplus-ai-cbc2.firebaseapp.com',
    storageBucket: 'eduplus-ai-cbc2.firebasestorage.app',
  );
}
