/// Subset of the K1 evaluator (spec/semantics/expressions.md).
///
/// Guards in a compiled model are AST nodes. This evaluates the comparisons and
/// boolean connectives a guard is written in. An operator outside that subset is
/// unsupported: the caller must refuse it, not treat it as false and continue.

class EvalOutcome {
  final bool supported;
  final Object? value;

  const EvalOutcome.supported(this.value) : supported = true;
  const EvalOutcome.unsupported()
      : supported = false,
        value = null;
}

EvalOutcome evalExpr(Object? node, Map<String, dynamic> record) {
  if (node is! Map) return const EvalOutcome.unsupported();
  final obj = Map<String, dynamic>.from(node);
  if (obj.containsKey('literal')) return EvalOutcome.supported(obj['literal']);
  if (obj.containsKey(r'$bind')) {
    final path = obj[r'$bind'];
    if (path is! String) return const EvalOutcome.unsupported();
    return EvalOutcome.supported(resolveBind(path, record));
  }
  final op = obj[r'$expr'];
  if (op is! String) return const EvalOutcome.unsupported();
  final rawArgs = obj['args'];
  final args = rawArgs is List ? rawArgs : const [];
  return evalCall(op, args, record);
}

EvalOutcome evalCall(String op, List<dynamic> args, Map<String, dynamic> record) {
  if (op == '!' || op == 'not') {
    if (args.length != 1) return const EvalOutcome.unsupported();
    final inner = evalExpr(args[0], record);
    if (!inner.supported) return inner;
    return EvalOutcome.supported(!truthy(inner.value));
  }
  if (op == '&&' || op == 'and' || op == '||' || op == 'or') {
    if (args.length != 2) return const EvalOutcome.unsupported();
    final left = evalExpr(args[0], record);
    if (!left.supported) return left;
    if (op == '&&' || op == 'and') {
      if (!truthy(left.value)) return left;
    } else if (truthy(left.value)) {
      return left;
    }
    return evalExpr(args[1], record);
  }
  const comparisons = {
    '==',
    'eq',
    '!=',
    'neq',
    '<',
    '<=',
    '>',
    '>=',
    'lt',
    'lte',
    'gt',
    'gte',
  };
  if (comparisons.contains(op)) {
    if (args.length != 2) return const EvalOutcome.unsupported();
    final left = evalExpr(args[0], record);
    if (!left.supported) return left;
    final right = evalExpr(args[1], record);
    if (!right.supported) return right;
    return EvalOutcome.supported(compare(op, left.value, right.value));
  }
  return const EvalOutcome.unsupported();
}

bool compare(String op, Object? left, Object? right) {
  if (op == '==' || op == 'eq') {
    if (left == null && right == null) return true;
    if (left == null || right == null) return false;
    final ln = asNum(left);
    final rn = asNum(right);
    if (ln != null && rn != null) return ln == rn;
    return left == right;
  }
  if (op == '!=' || op == 'neq') {
    if (left == null && right == null) return false;
    if (left == null || right == null) return true;
    final ln = asNum(left);
    final rn = asNum(right);
    if (ln != null && rn != null) return ln != rn;
    return left != right;
  }
  if (left == null || right == null) return false;
  final ln = asNum(left);
  final rn = asNum(right);
  if (ln != null && rn != null) return order(op, ln, rn);
  if (left is String && right is String) return order(op, left, right);
  return false;
}

bool order(String op, Comparable left, Comparable right) {
  final cmp = left.compareTo(right);
  switch (op) {
    case '<':
    case 'lt':
      return cmp < 0;
    case '<=':
    case 'lte':
      return cmp <= 0;
    case '>':
    case 'gt':
      return cmp > 0;
    case '>=':
    case 'gte':
      return cmp >= 0;
    default:
      return false;
  }
}

Object? resolveBind(String path, Map<String, dynamic> record) {
  if (record.containsKey(path)) return record[path];
  Object? current = record;
  for (final seg in path.split('.')) {
    if (current is! Map || !current.containsKey(seg)) return null;
    current = current[seg];
  }
  return current;
}

bool truthy(Object? value) {
  if (value == null || value == false || value == '' || value == 0) return false;
  return true;
}

num? asNum(Object? value) {
  if (value is bool || value is! num) return null;
  return value;
}

/// Returns whether the guard passes. An unsupported node is `GUARD_UNSUPPORTED`;
/// a decided non-true value is `GUARD_FAILED`.
(bool, String) guardAllows(Object? when, Map<String, dynamic> record) {
  if (when == null) return (true, '');
  final outcome = evalExpr(when, record);
  if (!outcome.supported) return (false, 'GUARD_UNSUPPORTED');
  if (!truthy(outcome.value)) return (false, 'GUARD_FAILED');
  return (true, '');
}
