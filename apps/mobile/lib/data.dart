import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:firebase_auth/firebase_auth.dart';

/// Data access for the student app.
///
/// Every read here is scoped to the signed-in student's own USN, which comes
/// from a custom claim on their ID token — not from anything the app chooses.
/// Firestore security rules enforce the same scope server-side, so this class
/// is convenience, not the security boundary.
///
/// Note what is absent: parent contact details. They live in
/// `students/{usn}/private/parent`, which this app is denied at the rules
/// level, so a parent's phone number can never reach a student's device.
class StudentData {
  StudentData(this.usn);

  final String usn;
  final _db = FirebaseFirestore.instance;

  DocumentReference<Map<String, dynamic>> get _student =>
      _db.collection('students').doc(usn);

  /// The USN from the signed-in user's custom claims.
  ///
  /// Forces a token refresh so a claim set after sign-up is picked up without
  /// the student having to sign out and back in.
  static Future<String?> currentUsn({bool refresh = false}) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return null;
    final token = await user.getIdTokenResult(refresh);
    final usn = token.claims?['usn'];
    return usn is String && usn.isNotEmpty ? usn : null;
  }

  static Future<String?> currentRole({bool refresh = false}) async {
    final user = FirebaseAuth.instance.currentUser;
    if (user == null) return null;
    final token = await user.getIdTokenResult(refresh);
    final role = token.claims?['role'];
    return role is String ? role : null;
  }

  Stream<Map<String, dynamic>?> student() =>
      _student.snapshots().map((snapshot) => snapshot.data());

  /// The newest risk snapshot. This is what the home screen shows.
  Stream<Map<String, dynamic>?> latestSnapshot() => _student
      .collection('snapshots')
      .orderBy('createdAt', descending: true)
      .limit(1)
      .snapshots()
      .map((query) => query.docs.isEmpty ? null : query.docs.first.data());

  /// Snapshot history, oldest first — the order a progress chart reads in.
  Stream<List<Map<String, dynamic>>> history({int limit = 12}) => _student
      .collection('snapshots')
      .orderBy('createdAt', descending: true)
      .limit(limit)
      .snapshots()
      .map((query) => query.docs.map((d) => d.data()).toList().reversed.toList());

  Stream<Map<String, dynamic>?> latestReport() => _student
      .collection('reports')
      .orderBy('createdAt', descending: true)
      .limit(1)
      .snapshots()
      .map((query) => query.docs.isEmpty ? null : query.docs.first.data());

  /// Meetings with the mentor, soonest first.
  ///
  /// Read straight from Firestore under the security rules, like everything
  /// else here — the rules allow a student their own meetings and nobody
  /// else's, so there is no server call and no way to ask for another
  /// student's calendar. Cancelled meetings stay in the list so a student who
  /// was expecting one can see it was called off rather than wonder.
  Stream<List<Map<String, dynamic>>> meetings() =>
      _student.collection('meetings').snapshots().map((query) {
        final list = query.docs
            .map((d) => {...d.data(), 'meetingId': d.id})
            .where((m) => m['status'] != 'proposed')
            .toList();
        list.sort(
          (a, b) => ((a['startsAt'] ?? '') as String).compareTo((b['startsAt'] ?? '') as String),
        );
        return list;
      });

  Stream<List<Map<String, dynamic>>> tasks() =>
      _student.collection('tasks').snapshots().map((query) {
        final list = query.docs.map((d) => {...d.data(), 'taskId': d.id}).toList();
        // Open tasks first, then by due date. Done work sinks to the bottom
        // but stays visible — seeing what you finished is the point.
        list.sort((a, b) {
          final aDone = a['done'] == true;
          final bDone = b['done'] == true;
          if (aDone != bDone) return aDone ? 1 : -1;
          final aDue = (a['dueDate'] ?? '') as String;
          final bDue = (b['dueDate'] ?? '') as String;
          return aDue.compareTo(bDue);
        });
        return list;
      });

  /// Ticks a task off.
  ///
  /// The only write a student may make. Firestore rules allow exactly `done`
  /// and `doneAt` to change on their own tasks — the title, due date and the
  /// intervention it belongs to are not theirs to edit.
  Future<void> setTaskDone(String taskId, bool done) =>
      _student.collection('tasks').doc(taskId).update({
        'done': done,
        'doneAt': done ? DateTime.now().toUtc().toIso8601String() : null,
      });

  /// Attendance records, for the ring on the home screen.
  Stream<List<Map<String, dynamic>>> records({String? type}) {
    Query<Map<String, dynamic>> query = _student.collection('records');
    if (type != null) query = query.where('type', isEqualTo: type);
    return query.snapshots().map((q) => q.docs.map((d) => d.data()).toList());
  }

  /// The risk rules, so the app can say what the thresholds actually are.
  static Stream<Map<String, dynamic>?> riskRules() => FirebaseFirestore.instance
      .collection('config')
      .doc('riskRules')
      .snapshots()
      .map((snapshot) => snapshot.data());
}

/// Sums numerators and denominators rather than averaging percentages —
/// matching `aggregateRecords` in packages/core exactly, so the ring on this
/// screen and the score on the dashboard can never disagree.
double? percentOf(List<Map<String, dynamic>> records) {
  var achieved = 0.0;
  var possible = 0.0;
  for (final record in records) {
    achieved += (record['value'] as num?)?.toDouble() ?? 0;
    possible += (record['maxValue'] as num?)?.toDouble() ?? 0;
  }
  if (possible <= 0) return null;
  return (achieved / possible) * 100;
}
