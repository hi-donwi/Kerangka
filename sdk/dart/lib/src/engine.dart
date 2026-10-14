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

class DecisionResult {
  final bool matched;
  final int hitCount;
  final dynamic outputs;
  final String? error;
  final String? code;

  const DecisionResult({
    required this.matched,
    required this.hitCount,
    this.outputs,
    this.error,
    this.code,
  });

  @override
  String toString() =>
      'DecisionResult(matched: $matched, hitCount: $hitCount, outputs: $outputs, code: $code, error: $error)';
}

final _decimalWire = RegExp(r'^-?\d+(\.\d+)?$');
final _rangePattern = RegExp(r'^([\[(])\s*([0-9.]+)\s*\.\.\s*([0-9.]+)\s*([\])])$');

String _fieldTypeName(dynamic defVal) {
  if (defVal is String) {
    final parts = defVal.trim().split(RegExp(r'\s+'));
    if (parts.isNotEmpty) {
      var clean = parts[0];
      if (clean.endsWith('!')) clean = clean.substring(0, clean.length - 1);
      final idx = clean.indexOf('(');
      if (idx != -1) clean = clean.substring(0, idx);
      return clean.toLowerCase();
    }
  } else if (defVal is Map) {
    final t = defVal['type'];
    if (t is String) return t.toLowerCase();
  }
  return '';
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

  Map<String, dynamic> decodeRecord(String entityName, Map<String, dynamic> record) {
    final entity = entities[entityName] as Map<String, dynamic>?;
    if (entity == null) return record;
    final fields = (entity['fields'] as Map<String, dynamic>?) ?? {};
    return _decodeFields(fields, record, 0);
  }

  Map<String, dynamic> _decodeFields(Map<String, dynamic> defs, Map<String, dynamic> record, int depth) {
    if (depth > 16) return record;
    final out = Map<String, dynamic>.from(record);
    for (final entry in defs.entries) {
      final name = entry.key;
      final val = out[name];
      if (val == null) continue;
      out[name] = _decodeValue(entry.value, val, depth + 1);
    }
    return out;
  }

  dynamic _decodeValue(dynamic defVal, dynamic val, int depth) {
    final tname = _fieldTypeName(defVal);
    if (tname == 'decimal') {
      if (val is String && _decimalWire.hasMatch(val.trim())) {
        return num.tryParse(val.trim()) ?? val;
      }
      return val;
    }
    if (tname == 'list') {
      if (val is List) {
        final elemDef = defVal is Map ? defVal['element'] : null;
        if (elemDef != null) {
          return val.map((item) => _decodeValue(elemDef, item, depth + 1)).toList();
        }
      }
      return val;
    }

    var target = tname;
    if (defVal is Map && defVal['target'] is String) {
      target = (defVal['target'] as String).toLowerCase();
    }

    if (target.isNotEmpty && val is Map) {
      final targetEntity = entities[target] as Map<String, dynamic>?;
      if (targetEntity != null && targetEntity['embedded'] == true) {
        final targetFields = (targetEntity['fields'] as Map<String, dynamic>?) ?? {};
        return _decodeFields(targetFields, Map<String, dynamic>.from(val), depth);
      }
    }

    return val;
  }

  DecisionResult evaluateDecision(dynamic tableOrName, Map<String, dynamic> input) {
    Map<String, dynamic>? tableDef;
    String tableName = '';

    if (tableOrName is String) {
      tableName = tableOrName;
      final decisions = document['decisions'];
      if (decisions is Map) {
        final raw = decisions[tableOrName];
        if (raw is Map) {
          tableDef = Map<String, dynamic>.from(raw);
        }
      }
    } else if (tableOrName is Map) {
      tableDef = Map<String, dynamic>.from(tableOrName);
      tableName = (tableDef['name'] as String?) ?? '';
    }

    if (tableDef == null) {
      final targetName = tableName.isNotEmpty ? tableName : '$tableOrName';
      return DecisionResult(
        matched: false,
        hitCount: 0,
        error: "Decision table '$targetName' not found",
        code: 'TABLE_NOT_FOUND',
      );
    }

    if (tableName.isEmpty) {
      tableName = (tableDef['name'] as String?) ?? '';
    }

    final rawInputs = tableDef['inputs'] is List ? (tableDef['inputs'] as List) : const [];
    final inputs = rawInputs.map((e) => e is Map ? Map<String, dynamic>.from(e) : <String, dynamic>{}).toList();

    final rawOutputs = tableDef['outputs'] is List ? (tableDef['outputs'] as List) : const [];
    final outputs = rawOutputs.map((e) => e is Map ? Map<String, dynamic>.from(e) : <String, dynamic>{}).toList();

    final hitPolicy = ((tableDef['hitPolicy'] as String?) ?? 'first').toLowerCase();

    final rules = _parseDecisionRules(tableDef, inputs, outputs);
    final matchingOutputs = <Map<String, dynamic>>[];

    for (final rule in rules) {
      var ruleMatched = true;
      final ruleInputs = rule['inputs'] is List ? (rule['inputs'] as List) : const [];

      for (var i = 0; i < inputs.length; i++) {
        final colName = inputs[i]['name'] as String?;
        final cell = i < ruleInputs.length ? ruleInputs[i] : '-';
        final val = colName != null ? input[colName] : null;

        if (!_matchDecisionCell(cell, val)) {
          ruleMatched = false;
          break;
        }
      }

      if (ruleMatched) {
        final ruleOutputs = (rule['outputs'] as Map<String, dynamic>?) ?? {};
        final resolved = _resolveDecisionOutputs(ruleOutputs, outputs, input);
        matchingOutputs.add(resolved);
        if (hitPolicy == 'first') {
          break;
        }
      }
    }

    if (matchingOutputs.isEmpty) {
      return DecisionResult(
        matched: false,
        hitCount: 0,
        error: "Decision table '$tableName' matched no row",
        code: 'DECISION_NO_MATCH',
      );
    }

    if (hitPolicy == 'unique') {
      if (matchingOutputs.length > 1) {
        return DecisionResult(
          matched: false,
          hitCount: matchingOutputs.length,
          error: "Unique hit policy violated: ${matchingOutputs.length} rules matched in '$tableName'",
          code: 'UNIQUE_VIOLATION',
        );
      }
      return DecisionResult(
        matched: true,
        hitCount: 1,
        outputs: matchingOutputs[0],
      );
    }

    if (hitPolicy == 'collect') {
      return DecisionResult(
        matched: true,
        hitCount: matchingOutputs.length,
        outputs: matchingOutputs,
      );
    }

    return DecisionResult(
      matched: true,
      hitCount: matchingOutputs.length,
      outputs: matchingOutputs[0],
    );
  }

  DecisionResult decide(dynamic tableOrName, Map<String, dynamic> input) =>
      evaluateDecision(tableOrName, input);

  bool _matchDecisionCell(dynamic cell, dynamic val) {
    if (cell == null || cell == '-') return true;

    if (cell is String) {
      final trimmed = cell.trim();
      if (trimmed == '-' || trimmed.isEmpty) return true;

      final isNum = val is num;
      final valNum = isNum ? val : 0;

      if (trimmed.startsWith('>=') && isNum) {
        final target = num.tryParse(trimmed.substring(2).trim());
        return target != null && valNum >= target;
      }
      if (trimmed.startsWith('>') && isNum) {
        final target = num.tryParse(trimmed.substring(1).trim());
        return target != null && valNum > target;
      }
      if (trimmed.startsWith('<=') && isNum) {
        final target = num.tryParse(trimmed.substring(2).trim());
        return target != null && valNum <= target;
      }
      if (trimmed.startsWith('<') && isNum) {
        final target = num.tryParse(trimmed.substring(1).trim());
        return target != null && valNum < target;
      }

      if ((trimmed.startsWith('[') || trimmed.startsWith('(')) && isNum) {
        final m = _rangePattern.firstMatch(trimmed);
        if (m != null) {
          final leftBracket = m.group(1);
          final minStr = m.group(2);
          final maxStr = m.group(3);
          final rightBracket = m.group(4);
          final minVal = num.tryParse(minStr ?? '');
          final maxVal = num.tryParse(maxStr ?? '');
          if (minVal != null && maxVal != null) {
            final minOk = leftBracket == '[' ? valNum >= minVal : valNum > minVal;
            final maxOk = rightBracket == ']' ? valNum <= maxVal : valNum < maxVal;
            return minOk && maxOk;
          }
        }
      }

      if (trimmed.contains(',')) {
        final parts = trimmed.split(',').map((p) {
          var s = p.trim();
          if ((s.startsWith("'") && s.endsWith("'")) || (s.startsWith('"') && s.endsWith('"'))) {
            s = s.substring(1, s.length - 1);
          }
          return s;
        }).toList();
        return parts.contains(val?.toString());
      }

      var clean = trimmed;
      if ((clean.startsWith("'") && clean.endsWith("'")) || (clean.startsWith('"') && clean.endsWith('"'))) {
        clean = clean.substring(1, clean.length - 1);
      }
      return val?.toString() == clean;
    }

    if (cell is num) {
      if (val is num) return cell == val;
      return false;
    }

    if (cell is bool) {
      return val is bool && cell == val;
    }

    if (cell is Map) {
      final res = evalNode(cell, {'cell': val, 'value': val, 'input': {}}, null);
      return res.supported && truthy(res.value);
    }

    return false;
  }

  List<Map<String, dynamic>> _parseDecisionRules(
    Map<String, dynamic> tableDef,
    List<Map<String, dynamic>> inputs,
    List<Map<String, dynamic>> outputs,
  ) {
    final rawRules = tableDef['rules'];
    if (rawRules is List && rawRules.isNotEmpty) {
      return rawRules.map((e) => e is Map ? Map<String, dynamic>.from(e) : <String, dynamic>{}).toList();
    }

    final rows = tableDef['rows'];
    if (rows is! List) return const [];

    final rules = <Map<String, dynamic>>[];
    for (var i = 0; i < rows.length; i++) {
      final row = rows[i];
      if (row is! Map) continue;
      final rowMap = Map<String, dynamic>.from(row);

      final rInputs = inputs.map((col) {
        final name = col['name'] as String?;
        return name != null && rowMap.containsKey(name) ? rowMap[name] : '-';
      }).toList();

      final rOutputs = <String, dynamic>{};
      for (final out in outputs) {
        final name = out['name'] as String?;
        if (name != null && rowMap.containsKey(name)) {
          rOutputs[name] = rowMap[name];
        }
      }

      rules.add({
        'id': 'row-${i + 1}',
        'inputs': rInputs,
        'outputs': rOutputs,
      });
    }

    return rules;
  }

  Map<String, dynamic> _resolveDecisionOutputs(
    Map<String, dynamic> ruleOutputs,
    List<Map<String, dynamic>> columns,
    Map<String, dynamic> inputData,
  ) {
    final resolved = <String, dynamic>{};
    for (final col in columns) {
      final name = col['name'] as String?;
      if (name == null) continue;
      final val = ruleOutputs[name];
      final colType = (col['type'] as String? ?? '').toLowerCase();

      if (val is String) {
        var trimmed = val.trim();
        if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
            (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
          resolved[name] = trimmed.substring(1, trimmed.length - 1);
        } else if ((colType.startsWith('int') || colType.startsWith('number') || colType.startsWith('decimal')) &&
            _decimalWire.hasMatch(trimmed)) {
          resolved[name] = num.tryParse(trimmed) ?? trimmed;
        } else if (colType.startsWith('bool')) {
          resolved[name] = trimmed.toLowerCase() == 'true';
        } else {
          resolved[name] = trimmed;
        }
      } else {
        resolved[name] = val;
      }
    }

    for (final entry in ruleOutputs.entries) {
      if (!resolved.containsKey(entry.key)) {
        resolved[entry.key] = entry.value;
      }
    }
    return resolved;
  }

  /// Materializes computed fields and default values on a record.
  Map<String, dynamic> compute(String entityName, Map<String, dynamic> record) {
    record = decodeRecord(entityName, record);
    final entity = entities[entityName] as Map<String, dynamic>?;
    if (entity == null) {
      return Map<String, dynamic>.from(record);
    }

    final fields = (entity['fields'] as Map<String, dynamic>?) ?? {};
    final result = Map<String, dynamic>.from(record);

    for (final entry in fields.entries) {
      final fieldName = entry.key;
      final rawDef = entry.value;
      final fieldDef = rawDef is Map<String, dynamic> ? rawDef : const <String, dynamic>{};

      // Set default if missing
      if (!result.containsKey(fieldName) &&
          fieldDef.containsKey('default') &&
          fieldDef['default'] != null) {
        result[fieldName] = fieldDef['default'];
      }

      final computeExpr = fieldDef['compute'];
      if (computeExpr != null) {
        if (computeExpr is String && computeExpr.contains('(') && computeExpr.endsWith(')')) {
          final openIdx = computeExpr.indexOf('(');
          final funcName = computeExpr.substring(0, openIdx).trim();
          final argsStr = computeExpr.substring(openIdx + 1, computeExpr.length - 1).trim();
          final argNames = argsStr.isNotEmpty
              ? argsStr.split(',').map((p) => p.trim()).where((p) => p.isNotEmpty).toList()
              : <String>[];
          final inputMap = <String, dynamic>{};
          for (final argName in argNames) {
            inputMap[argName] = result[argName];
          }
          final res = evaluateDecision(funcName, inputMap);
          if (res.matched) {
            final outVal = res.outputs;
            if (outVal is Map && outVal.length == 1) {
              result[fieldName] = outVal.values.first;
            } else {
              result[fieldName] = outVal;
            }
          }
        } else if (computeExpr is Map<String, dynamic>) {
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
          } else if (computeExpr['type'] == 'call') {
            final funcName = computeExpr['func'] as String?;
            if (funcName != null) {
              final inputMap = <String, dynamic>{};
              final rawArgs = computeExpr['args'];
              if (rawArgs is List) {
                for (var i = 0; i < rawArgs.length; i++) {
                  final arg = rawArgs[i];
                  if (arg is Map && arg['type'] == 'ref') {
                    final refName = arg['name'] as String?;
                    if (refName != null) inputMap[refName] = result[refName];
                  } else {
                    inputMap['arg$i'] = arg;
                  }
                }
              }
              final res = evaluateDecision(funcName, inputMap);
              if (res.matched) {
                result[fieldName] = res.outputs;
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

    record = decodeRecord(entityName, record);
    final errors = <ValidationErrorItem>[];
    final fields = (entity['fields'] as Map<String, dynamic>?) ?? {};

    for (final entry in fields.entries) {
      final fieldName = entry.key;
      final rawDef = entry.value;
      final fieldDef = rawDef is Map<String, dynamic> ? rawDef : const <String, dynamic>{};

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

      // Decimal wire validation check
      final tname = _fieldTypeName(rawDef);
      if (tname == 'decimal' && val != null) {
        if (val is! num) {
          errors.add(ValidationErrorItem(
            field: fieldName,
            message: "Field '$fieldName' must be a decimal number, such as \"12.50\"",
            code: 'INVALID_DECIMAL',
          ));
          continue;
        }
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

    record = decodeRecord(entityName, record);

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

