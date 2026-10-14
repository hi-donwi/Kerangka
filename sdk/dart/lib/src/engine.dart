/// Kerangka Reference Engine in Dart.
/// Specification Version: 0.1
/// Status: Draft
/// License: Apache-2.0

import 'eval.dart';

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

class Decision {
  final bool allowed;
  final String? code;
  final String? reason;

  const Decision({
    required this.allowed,
    this.code,
    this.reason,
  });

  @override
  String toString() => 'Decision(allowed: $allowed, code: $code, reason: $reason)';
}

class ReadScope {
  final bool allowed;
  final String? code;
  final String? reason;
  final Object? where;

  const ReadScope({
    required this.allowed,
    this.code,
    this.reason,
    this.where,
  });

  @override
  String toString() => 'ReadScope(allowed: $allowed, code: $code, reason: $reason, where: $where)';
}

/// Pure in-memory reference execution engine for Kerangka models in Dart.
class ReferenceEngine {
  final Map<String, dynamic> document;
  final Map<String, dynamic> entities;

  ReferenceEngine(this.document)
      : entities = (document['entities'] as Map<String, dynamic>?) ?? {};

  Decision canOperate(
    String entityName,
    String operation, {
    Map<String, dynamic>? actor,
    Map<String, dynamic>? record,
  }) {
    final entity = entities[entityName] as Map<String, dynamic>?;
    if (entity == null) {
      return Decision(
        allowed: false,
        code: 'UNKNOWN_ENTITY',
        reason: "Unknown entity '$entityName'",
      );
    }

    final permissions = entity['permissions'];
    if (permissions is! Map || !permissions.containsKey(operation)) {
      return const Decision(allowed: true);
    }

    final declared = permissions[operation];
    final rawRoles = actor?['roles'];
    final roles = rawRoles is List ? rawRoles.map((e) => e.toString()).toList() : const <String>[];

    if (declared is List) {
      if (declared.any((r) => roles.contains(r))) {
        return const Decision(allowed: true);
      }
      if (declared.isEmpty) {
        return Decision(
          allowed: false,
          code: 'PERMISSION_DENIED',
          reason: "'$operation' on '$entityName' is granted to no role",
        );
      }
      return Decision(
        allowed: false,
        code: 'PERMISSION_DENIED',
        reason: "'$operation' on '$entityName' requires one of $declared",
      );
    }

    if (declared is Map) {
      final conditions = <dynamic>[];
      for (final entry in declared.entries) {
        final role = entry.key.toString();
        if (!roles.contains(role)) continue;
        if (entry.value == true) {
          return const Decision(allowed: true);
        }
        if (entry.value == false) continue;
        conditions.add(entry.value);
      }

      if (conditions.isNotEmpty) {
        if (record == null) {
          return Decision(
            allowed: false,
            code: 'PERMISSION_NEEDS_RECORD',
            reason: "'$operation' on '$entityName' is granted to this actor only under a condition on the record",
          );
        }
        for (final cond in conditions) {
          final outcome = evalCondition(cond, record, actor);
          if (outcome.supported && truthy(outcome.value)) {
            return const Decision(allowed: true);
          }
        }
        return Decision(
          allowed: false,
          code: 'PERMISSION_DENIED',
          reason: "'$operation' on '$entityName' condition evaluated to false or unsupported",
        );
      }

      return Decision(
        allowed: false,
        code: 'PERMISSION_DENIED',
        reason: "'$operation' on '$entityName' is not granted to this actor",
      );
    }

    return Decision(
      allowed: false,
      code: 'PERMISSION_DENIED',
      reason: "'$operation' on '$entityName' has a permission this engine cannot read",
    );
  }

  Decision authorize(
    String entityName,
    String operation, {
    List<String>? roles,
  }) {
    final dec = canOperate(entityName, operation, actor: {'roles': roles ?? const []});
    if (dec.code == 'PERMISSION_NEEDS_RECORD') {
      return Decision(allowed: false, code: 'UNSUPPORTED', reason: dec.reason);
    }
    return dec;
  }

  ReadScope authorizeRead(
    String entityName, [
    Map<String, dynamic>? actor,
  ]) {
    final entity = entities[entityName] as Map<String, dynamic>?;
    if (entity == null) {
      return ReadScope(
        allowed: false,
        code: 'UNKNOWN_ENTITY',
        reason: "Entity '$entityName' is not in the model, so nothing is known about who may read it",
      );
    }

    final conditions = <dynamic>[];
    final fields = (entity['fields'] as Map<String, dynamic>?) ?? {};
    final multitenancy = document['multitenancy'];
    final isTenantScoped = fields.containsKey('tenantId') || multitenancy != null;

    if (isTenantScoped) {
      final tenantId = actor?['tenantId'];
      if (tenantId == null) {
        return ReadScope(
          allowed: false,
          code: 'PERMISSION_DENIED',
          reason: "'$entityName' is tenant-scoped and the request established no tenant.",
        );
      }
      conditions.add(['==', ['get', 'tenantId'], tenantId]);
    }

    final traits = (entity['traits'] as List?) ?? const [];
    final isSoftDelete = traits.contains('std:softDelete') ||
        fields.containsKey('deleted') ||
        fields.containsKey('deletedAt');

    if (isSoftDelete) {
      if (fields.containsKey('deleted')) {
        conditions.add(['==', ['get', 'deleted'], false]);
      } else if (fields.containsKey('deletedAt')) {
        conditions.add(['is_null', ['get', 'deletedAt']]);
      }
    }

    final declared = entity['readFilter'];
    if (declared is String && declared.isNotEmpty) {
      return ReadScope(
        allowed: false,
        code: 'READ_FILTER_NOT_COMPILED',
        reason: "The readFilter on '$entityName' is still a string, so it was never lowered and would be ignored.",
      );
    }
    if (declared is List && declared.isNotEmpty) {
      conditions.add(declared);
    }

    if (conditions.isEmpty) {
      return const ReadScope(allowed: true, where: null);
    }
    if (conditions.length == 1) {
      return ReadScope(allowed: true, where: conditions[0]);
    }
    return ReadScope(allowed: true, where: ['and', ...conditions]);
  }

  Object? readFilter(
    String entityName, [
    Map<String, dynamic>? actor,
  ]) {
    final scope = authorizeRead(entityName, actor);
    return scope.allowed ? scope.where : null;
  }

  bool evalFilter(
    Object? predicate, [
    Map<String, dynamic>? record,
    Map<String, dynamic>? actor,
  ]) {
    if (predicate == null) return true;
    final outcome = evalNode(predicate, record, actor);
    return outcome.supported && truthy(outcome.value);
  }

  bool hasReadFilter(String entityName) {
    final entity = entities[entityName] as Map<String, dynamic>?;
    return entity != null && entity['readFilter'] != null;
  }

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

    // A guard this subset cannot evaluate refuses the transition. One it can evaluate
    // must be true; false is GUARD_FAILED, not a skipped check (ADR-0008).
    final when = transitionDef['when'];
    if (when != null) {
      final decision = guardAllows(when, record);
      if (!decision.$1) {
        final message = decision.$2 == 'GUARD_UNSUPPORTED'
            ? "Transition '$transitionName' has a guard this engine cannot evaluate yet; "
                'run it through the reference engine'
            : "Transition '$transitionName' guard evaluated to false";
        return ExecutionResult(ok: false, error: decision.$2, message: message);
      }
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
