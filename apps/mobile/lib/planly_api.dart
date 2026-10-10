import 'dart:convert';
import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

import 'app_config.dart';

/// Talks to Planly on the server.
///
/// Firestore reads happen straight from the device under the security rules,
/// but Planly needs Claude and an API key, so it lives server-side. The app
/// authenticates with its Firebase ID token and never sends a USN — the server
/// reads that from the token's claims, which is what stops one student asking
/// about another.
class PlanlyApi {
  PlanlyApi({String? baseUrl})
      : baseUrl = (baseUrl ?? AppConfig.apiBase).replaceAll(RegExp(r'/+$'), '');

  final String baseUrl;

  /// True when the app is still pointed at the emulator-only default, which is
  /// by far the commonest reason Planly cannot connect on a real device.
  bool get isEmulatorDefault => baseUrl.contains('10.0.2.2');

  Future<Map<String, String>> _headers() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) {
      throw PlanlyException('You are signed out. Sign in again.');
    }
    final token = await user.getIdToken();
    return {
      'content-type': 'application/json',
      'authorization': 'Bearer $token',
      // ngrok's free tier shows an interstitial HTML page to anything that
      // looks like a browser. This header opts out, so a tunnelled dev server
      // returns JSON rather than a warning page the app cannot parse.
      'ngrok-skip-browser-warning': 'true',
    };
  }

  /// Said when the request never reached the server at all.
  String get _unreachable {
    if (isEmulatorDefault) {
      return 'Could not reach Planly.\n\n'
          'This app has no server address configured, so it fell back to one '
          'that only works on the Android emulator.\n\n'
          'Ask your college to set config/app.apiBaseUrl, then reopen the app. '
          'A developer can instead rebuild with:\n'
          'flutter run --dart-define=EDUPLUS_API=https://<your-url>';
    }
    return 'Could not reach Planly at $baseUrl.\n\n'
        'Check the dashboard is running and that this device is on the same '
        'network.';
  }

  Future<Map<String, dynamic>> _send(
    String method,
    String path, {
    Object? body,
    Duration timeout = const Duration(seconds: 120),
  }) async {
    final uri = Uri.parse('$baseUrl$path');
    try {
      final headers = await _headers();
      final request = http.Request(method, uri)..headers.addAll(headers);
      if (body != null) request.body = jsonEncode(body);

      final streamed = await request.send().timeout(timeout);
      final response = await http.Response.fromStream(streamed);
      final decoded = response.body.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(response.body) as Map<String, dynamic>;

      if (response.statusCode >= 400) {
        throw PlanlyException(
          (decoded['error'] as String?) ??
              'Planly could not answer (${response.statusCode}).',
        );
      }
      return decoded;
    } on PlanlyException {
      rethrow;
    } catch (_) {
      // The commonest causes are the dev server not running, or a phone that
      // cannot see the laptop — say which, rather than "unknown error".
      throw PlanlyException(_unreachable);
    }
  }

  /// One conversational turn. An empty history asks Planly to open.
  Future<PlanlyReply> chat(List<PlanlyMessage> history) async {
    final json = await _send('POST', '/api/planly/chat', body: {
      'messages': history.map((m) => m.toJson()).toList(),
    });
    return PlanlyReply(
      reply: json['reply'] as String? ?? '',
      toolsUsed: ((json['toolsUsed'] as List?) ?? []).cast<String>(),
      changedPlan: json['changedPlan'] == true,
    );
  }

  /// Builds a whole plan — the "Make me a plan" button.
  Future<PlanlyReply> makePlan({int weeks = 2, String? note}) async {
    final json = await _send(
      'POST',
      '/api/planly/plan',
      body: {'weeks': weeks, if (note != null && note.isNotEmpty) 'note': note},
      timeout: const Duration(seconds: 180),
    );
    return PlanlyReply(
      reply: json['reply'] as String? ?? '',
      toolsUsed: ((json['toolsUsed'] as List?) ?? []).cast<String>(),
      changedPlan: json['changedPlan'] == true,
    );
  }
}

class PlanlyMessage {
  const PlanlyMessage({required this.role, required this.content});

  final String role; // 'user' | 'assistant'
  final String content;

  Map<String, dynamic> toJson() => {'role': role, 'content': content};
}

class PlanlyReply {
  const PlanlyReply({
    required this.reply,
    required this.toolsUsed,
    required this.changedPlan,
  });

  final String reply;
  final List<String> toolsUsed;

  /// True when the turn wrote a plan, tasks or an activity, so the calendar is
  /// now out of date on screen.
  final bool changedPlan;
}

class PlanlyException implements Exception {
  PlanlyException(this.message);
  final String message;

  @override
  String toString() => message;
}
