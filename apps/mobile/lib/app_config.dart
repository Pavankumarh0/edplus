import 'package:cloud_firestore/cloud_firestore.dart';

/// Where the server is.
///
/// This has bitten us repeatedly: the build-time default only works on the
/// Android emulator, a physical device needs the LAN address or a tunnel, and
/// an ngrok URL changes every time the tunnel restarts — each change meaning a
/// rebuild and reinstall.
///
/// So the address lives in Firestore at `config/app`, which the security rules
/// already let any signed-in user read. Changing it is one write; the app picks
/// it up on the next launch, or immediately via [refresh]. The dart-define
/// still wins when it is set, so a developer pointing at their own machine is
/// not overridden by whatever the shared config says.
class AppConfig {
  AppConfig._();

  static const _dartDefine = String.fromEnvironment('EDUPLUS_API');

  /// Only correct on the Android emulator, where it aliases the host machine.
  static const _lastResort = 'http://10.0.2.2:3000';

  static String? _fromServer;

  /// The base URL to call, best source first.
  static String get apiBase {
    if (_dartDefine.isNotEmpty) return _trim(_dartDefine);
    final fromServer = _fromServer;
    if (fromServer != null && fromServer.isNotEmpty) return _trim(fromServer);
    return _lastResort;
  }

  /// True when nothing better than the emulator-only default was found.
  static bool get isUnconfigured =>
      _dartDefine.isEmpty && (_fromServer == null || _fromServer!.isEmpty);

  static String _trim(String url) => url.replaceAll(RegExp(r'/+$'), '');

  /// Reads `config/app`. Safe to call before sign-in — it just fails quietly.
  ///
  /// Never throws: a missing config document must not stop the app starting,
  /// because the student can still read their own record straight from
  /// Firestore. Only Planly needs the server.
  static Future<void> refresh() async {
    try {
      final snap =
          await FirebaseFirestore.instance.collection('config').doc('app').get();
      final value = snap.data()?['apiBaseUrl'];
      if (value is String && value.isNotEmpty) _fromServer = value;
    } catch (_) {
      // Offline, signed out, or no such document. The getter falls back.
    }
  }
}
