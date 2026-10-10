import 'dart:convert';

import 'package:firebase_auth/firebase_auth.dart';
import 'package:http/http.dart' as http;

import 'app_config.dart';
import 'planly_api.dart' show PlanlyException;

/// Assignments, from the student's side.
///
/// Nothing here sends a USN. The server reads it from the Firebase ID token,
/// which is what stops one student submitting as another — the capability is
/// absent rather than merely refused.
///
/// The deadline is also the server's business. This client does not compute
/// on-time or late; it displays what it is told, so a phone with its clock
/// wound back changes nothing.
class AssignmentsApi {
  AssignmentsApi({String? baseUrl})
      : baseUrl = (baseUrl ?? AppConfig.apiBase).replaceAll(RegExp(r'/+$'), '');

  final String baseUrl;

  Future<Map<String, String>> _headers() async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw PlanlyException('You are signed out. Sign in again.');
    final token = await user.getIdToken();
    return {
      'content-type': 'application/json',
      'authorization': 'Bearer $token',
      'ngrok-skip-browser-warning': 'true',
    };
  }

  Future<Map<String, dynamic>> _send(String method, Object? body) async {
    final uri = Uri.parse('$baseUrl/api/assignments/student');
    try {
      final request = http.Request(method, uri)..headers.addAll(await _headers());
      if (body != null) request.body = jsonEncode(body);

      final streamed = await request.send().timeout(const Duration(seconds: 45));
      final response = await http.Response.fromStream(streamed);
      final decoded = response.body.isEmpty
          ? <String, dynamic>{}
          : jsonDecode(response.body) as Map<String, dynamic>;

      if (response.statusCode >= 400) {
        throw PlanlyException(
          (decoded['error'] as String?) ?? 'That did not work (${response.statusCode}).',
        );
      }
      return decoded;
    } on PlanlyException {
      rethrow;
    } catch (_) {
      throw PlanlyException(
        'Could not reach EduPlus.\n\nCheck your connection, then try again.',
      );
    }
  }

  /// Everything this student is eligible for, with their own status on each.
  Future<List<Map<String, dynamic>>> list() async {
    final json = await _send('GET', null);
    return ((json['assignments'] as List?) ?? []).cast<Map<String, dynamic>>();
  }

  /// Opens a scanned or typed code. Does NOT submit anything.
  Future<Map<String, dynamic>> resolve(String code) async {
    final json = await _send('PUT', {'code': code});
    return json['assignment'] as Map<String, dynamic>;
  }

  /// Submits, or replaces an earlier attempt. Returns the message to show.
  Future<({Map<String, dynamic> assignment, String message})> submit({
    required String assignmentId,
    required String content,
  }) async {
    final json = await _send('POST', {'assignmentId': assignmentId, 'content': content});
    return (
      assignment: json['assignment'] as Map<String, dynamic>,
      message: (json['message'] as String?) ?? 'Submitted.',
    );
  }
}

/// Recording a classroom exit.
///
/// Separate from assignments because it is a different kind of thing: an
/// assignment code is meant to be shared and lasts for days, an exit code is a
/// momentary credential that rotates every few seconds.
class ExitApi {
  ExitApi({String? baseUrl})
      : baseUrl = (baseUrl ?? AppConfig.apiBase).replaceAll(RegExp(r'/+$'), '');

  final String baseUrl;

  /// Sends a scanned payload. The server decides everything that matters:
  /// whether the code is still valid, whether this student's class is the one
  /// the session is for, and what time it is.
  Future<({String message, bool repeat})> verify(String payload) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) throw PlanlyException('You are signed out. Sign in again.');
    final token = await user.getIdToken();

    try {
      final response = await http
          .post(
            Uri.parse('$baseUrl/api/exit-sessions/verify'),
            headers: {
              'content-type': 'application/json',
              'authorization': 'Bearer $token',
              'ngrok-skip-browser-warning': 'true',
            },
            body: jsonEncode({'payload': payload}),
          )
          .timeout(const Duration(seconds: 30));

      final decoded = jsonDecode(response.body) as Map<String, dynamic>;
      if (response.statusCode >= 400) {
        throw PlanlyException((decoded['error'] as String?) ?? 'That code was not accepted.');
      }
      return (
        message: (decoded['message'] as String?) ?? 'Exit recorded.',
        repeat: decoded['repeat'] == true,
      );
    } on PlanlyException {
      rethrow;
    } catch (_) {
      throw PlanlyException('Could not reach EduPlus. Check your connection.');
    }
  }
}
