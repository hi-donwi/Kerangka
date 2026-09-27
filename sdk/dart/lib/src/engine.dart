/// Kerangka Reference Engine in Dart.
/// Specification Version: 0.1
/// Status: Draft
/// License: Apache-2.0

class ValidationErrorItem {
  final String message;
  final String? field;
  final String code;

  const ValidationErrorItem({
    required this.message,
    this.field,
    this.code = 'VALIDATION_ERROR',
  });

  @override
  String toString() => 'ValidationErrorItem(field: $field, code: $code, message: $message)';
}

class ValidationResult {
  final bool valid;
  final List<ValidationErrorItem> errors;

  const ValidationResult({
    required this.valid,
    this.errors = const [],
  });

  @override
  String toString() => 'ValidationResult(valid: $valid, errors: $errors)';
}

class ExecutionResult {
  final bool ok;
  final Map<String, dynamic>? record;
  final String? error;
  final String? message;
  final List<Map<String, dynamic>> events;

  const ExecutionResult({
    required this.ok,
    this.record,
    this.error,
    this.message,
    this.events = const [],
  });

  @override
  String toString() => 'ExecutionResult(ok: $ok, error: $error, message: $message, events: $events)';
}

/// Pure in-memory reference execution engine for Kerangka models in Dart.
class ReferenceEngine {
  final Map<String, dynamic> document;
  final Map<String, dynamic> entities;

  ReferenceEngine(this.document)
      : entities = (document['entities'] as Map<String, dynamic>?) ?? {};

  /// Materializes computed fields and default values on a record.
  Map<String, dynamic> compute(String entityName, Map<String, dynamic> record) {
    final entity = entities[entityName] as Map<String, dynamic>?;
    if (entity == null) {
      return Map<String, dynamic>.from(record);
    }

    final fields = (entity['fields'] as Map<String, dynamic>?) ?? {};
    final result = Map<String, dynamic>.from(record);

    for (final entry in fields.entries) {
      final fieldName = entry.key;
      final fieldDef = entry.value;

      if (fieldDef is Map<String, dynamic>) {
        // Set default if missing
        if (!result.containsKey(fieldName) &&
            fieldDef.containsKey('default') &&
            fieldDef['default'] != null) {
          result[fieldName] = fieldDef['default'];
        }

        // Aggregate compute simulation: sum(lines, qty * unitPrice)
        final computeExpr = fieldDef['compute'];
        if (computeExpr is Map<String, dynamic>) {
          if (computeExpr['type'] == 'call' && computeExpr['func'] == 'sum') {
            final args = computeExpr['args'];
            if (args is List && args.isNotEmpty) {
              final firstArg = args[0];
              if (firstArg is Map<String, dynamic> && firstArg['type'] == 'ref') {
                final collectionKey = firstArg['name'] as String?;
                if (collectionKey != null) {
                  final lines = result[collectionKey];
                  if (lines is List) {
                    num total = 0;
                    for (final item in lines) {
                      if (item is Map) {
                        final qty = _toNum(item['qty']);
                        final unitPrice = _toNum(item['unitPrice']);
                        total += (qty * unitPrice);
                      }
                    }
                    result[fieldName] = total;
                  }
                }
              }
            }
          }
        }
      }
    }

    return result;
  }

  /// Validates fields, requiredness, types, and enum values.
  ValidationResult validate(String entityName, Map<String, dynamic> record) {
    final entity = entities[entityName] as Map<String, dynamic>?;
    if (entity == null) {
      return ValidationResult(
        valid: false,
        errors: [
          ValidationErrorItem(
            message: "Unknown entity '$entityName'",
            code: 'UNKNOWN_ENTITY',
          ),
        ],
      );
    }

    final errors = <ValidationErrorItem>[];
    final fields = (entity['fields'] as Map<String, dynamic>?) ?? {};

    for (final entry in fields.entries) {
      final fieldName = entry.key;
      final fieldDef = entry.value;

      if (fieldDef is! Map<String, dynamic>) continue;

      final val = record[fieldName];

      // Required check
      final isRequired = fieldDef['required'] == true;
      if (isRequired && (val == null || (val is String && val.trim().isEmpty))) {
        errors.add(ValidationErrorItem(
          field: fieldName,
          message: "Field '$fieldName' is required",
          code: 'REQUIRED_FIELD',
        ));
        continue;
      }

      if (val != null) {
        final fieldType = fieldDef['type'];
        if (fieldType == 'enum' && fieldDef.containsKey('values')) {
          final allowedValues = fieldDef['values'];
          if (allowedValues is List && !allowedValues.contains(val)) {
            errors.add(ValidationErrorItem(
              field: fieldName,
              message: "Value '$val' not in allowed enum values $allowedValues",
              code: 'INVALID_ENUM',
            ));
          }
        }
      }
    }

    return ValidationResult(valid: errors.isEmpty, errors: errors);
  }

  /// Executes a workflow state transition deterministically.
  ExecutionResult transition(
    String entityName,
    Map<String, dynamic> record,
    String transitionName, {
    List<String>? actorRoles,
  }) {
    final entity = entities[entityName] as Map<String, dynamic>?;
    if (entity == null) {
      return const ExecutionResult(ok: false, error: 'UNKNOWN_ENTITY');
    }

    final workflow = entity['workflow'] as Map<String, dynamic>?;
    if (workflow == null) {
      return const ExecutionResult(ok: false, error: 'NO_WORKFLOW');
    }

    final transitions = (workflow['transitions'] as Map<String, dynamic>?) ?? {};
    final transitionDef = transitions[transitionName] as Map<String, dynamic>?;
    if (transitionDef == null) {
      return const ExecutionResult(ok: false, error: 'UNKNOWN_TRANSITION');
    }

    // Role verification
    final allowedRoles = transitionDef['roles'];
    if (allowedRoles is List && allowedRoles.isNotEmpty) {
      final roles = actorRoles ?? const [];
      final hasRole = allowedRoles.any((r) => roles.contains(r));
      if (!hasRole) {
        return const ExecutionResult(
          ok: false,
          error: 'PERMISSION_DENIED',
          message: 'Actor does not possess required role for this transition',
        );
      }
    }

    // State verification
    final statusField = (workflow['field'] as String?) ?? 'status';
    final currentState = record[statusField];
    final rawFrom = transitionDef['from'];
    final allowedFrom = <dynamic>[];
    if (rawFrom is List) {
      allowedFrom.addAll(rawFrom);
    } else if (rawFrom != null) {
      allowedFrom.add(rawFrom);
    }

    if (!allowedFrom.contains(currentState)) {
      return ExecutionResult(
        ok: false,
        error: 'INVALID_STATE_TRANSITION',
        message: "Cannot transition '$transitionName' from state '$currentState'",
      );
    }

    // Apply state transition
    final nextRecord = compute(entityName, record);
    final targetState = transitionDef['to'];
    nextRecord[statusField] = targetState;

    final events = <Map<String, dynamic>>[];
    final sideEffects = transitionDef['then'];
    if (sideEffects is List) {
      for (final effect in sideEffects) {
        if (effect is Map<String, dynamic>) {
          if (effect.containsKey('emit')) {
            events.add({
              'name': effect['emit'],
              'data': effect['data'],
            });
          }
          if (effect.containsKey('set') && effect['set'] is Map<String, dynamic>) {
            final setMap = effect['set'] as Map<String, dynamic>;
            for (final entry in setMap.entries) {
              if (entry.value == 'now()') {
                nextRecord[entry.key] = DateTime.now().toUtc().toIso8601String();
              } else {
                nextRecord[entry.key] = entry.value;
              }
            }
          }
        }
      }
    }

    final finalRecord = compute(entityName, nextRecord);
    return ExecutionResult(
      ok: true,
      record: finalRecord,
      events: events,
    );
  }

  static num _toNum(dynamic val) {
    if (val is num) return val;
    if (val is String) return num.tryParse(val) ?? 0;
    return 0;
  }
}
