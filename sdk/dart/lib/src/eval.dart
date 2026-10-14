/// Subset of the K1 evaluator (spec/semantics/expressions.md, ADR-0008, ADR-0040, ADR-0044).
///
/// Guards and read filters in a compiled model are AST nodes or lowered tuples.
/// Permission conditions can be string expressions (PLAN.md §5.1), AST nodes, or tuples.
/// This evaluates comparisons, boolean connectives, field accesses, and actor properties.
/// An operator or syntax outside that subset is unsupported: the caller must refuse it
/// (fail closed), not treat it as false or permissive and continue.

class EvalOutcome {
  final bool supported;
  final Object? value;

  const EvalOutcome.supported(this.value) : supported = true;
  const EvalOutcome.unsupported()
      : supported = false,
        value = null;
}

EvalOutcome evalExpr(Object? node, Map<String, dynamic> record) {
  return evalNode(node, record, null);
}

EvalOutcome evalNode(
  Object? node, [
  Map<String, dynamic>? record,
  Map<String, dynamic>? actor,
]) {
  if (node == null) return const EvalOutcome.supported(null);

  if (node is Map) {
    final obj = Map<String, dynamic>.from(node);
    if (obj.containsKey('literal')) return EvalOutcome.supported(obj['literal']);
    if (obj.containsKey(r'$bind')) {
      final path = obj[r'$bind'];
      if (path is! String) return const EvalOutcome.unsupported();
      return EvalOutcome.supported(resolvePath(path, record, actor));
    }
    final op = obj[r'$expr'];
    if (op is! String) return const EvalOutcome.unsupported();
    final rawArgs = obj['args'];
    final args = rawArgs is List ? rawArgs : const [];
    return evalCall(op, args, record, actor);
  }

  if (node is List) {
    return evalTuple(node, record, actor);
  }

  if (node is String || node is num || node is bool) {
    return EvalOutcome.supported(node);
  }

  return const EvalOutcome.unsupported();
}

EvalOutcome evalCall(
  String op,
  List<dynamic> args, [
  Map<String, dynamic>? record,
  Map<String, dynamic>? actor,
]) {
  if (op == '!' || op == 'not') {
    if (args.length != 1) return const EvalOutcome.unsupported();
    final inner = evalNode(args[0], record, actor);
    if (!inner.supported) return inner;
    return EvalOutcome.supported(!truthy(inner.value));
  }
  if (op == '&&' || op == 'and' || op == '||' || op == 'or') {
    if (args.length != 2) return const EvalOutcome.unsupported();
    final left = evalNode(args[0], record, actor);
    if (!left.supported) return left;
    if (op == '&&' || op == 'and') {
      if (!truthy(left.value)) return left;
    } else if (truthy(left.value)) {
      return left;
    }
    return evalNode(args[1], record, actor);
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
    final left = evalNode(args[0], record, actor);
    if (!left.supported) return left;
    final right = evalNode(args[1], record, actor);
    if (!right.supported) return right;
    return EvalOutcome.supported(compare(op, left.value, right.value));
  }
  return const EvalOutcome.unsupported();
}

EvalOutcome evalTuple(
  List<dynamic> tuple, [
  Map<String, dynamic>? record,
  Map<String, dynamic>? actor,
]) {
  if (tuple.isEmpty) return const EvalOutcome.unsupported();
  final op = tuple[0];
  if (op is! String) return const EvalOutcome.unsupported();

  if (op == 'literal') {
    if (tuple.length != 2) return const EvalOutcome.unsupported();
    return EvalOutcome.supported(tuple[1]);
  }

  if (op == 'get') {
    if (tuple.length < 2) return const EvalOutcome.unsupported();
    final path = tuple.skip(1).map((e) => e.toString()).join('.');
    return EvalOutcome.supported(resolveBind(path, record ?? const {}));
  }

  if (op == 'actor') {
    if (tuple.length < 2) return const EvalOutcome.unsupported();
    final path = tuple.skip(1).map((e) => e.toString()).join('.');
    return EvalOutcome.supported(resolveBind(path, actor ?? const {}));
  }

  if (op == 'is_null') {
    if (tuple.length != 2) return const EvalOutcome.unsupported();
    final inner = evalNode(tuple[1], record, actor);
    if (!inner.supported) return inner;
    return EvalOutcome.supported(inner.value == null);
  }

  if (op == '!' || op == 'not') {
    if (tuple.length != 2) return const EvalOutcome.unsupported();
    final inner = evalNode(tuple[1], record, actor);
    if (!inner.supported) return inner;
    return EvalOutcome.supported(!truthy(inner.value));
  }

  if (op == '&&' || op == 'and') {
    if (tuple.length < 2) return const EvalOutcome.unsupported();
    for (final item in tuple.skip(1)) {
      final res = evalNode(item, record, actor);
      if (!res.supported) return res;
      if (!truthy(res.value)) return const EvalOutcome.supported(false);
    }
    return const EvalOutcome.supported(true);
  }

  if (op == '||' || op == 'or') {
    if (tuple.length < 2) return const EvalOutcome.unsupported();
    for (final item in tuple.skip(1)) {
      final res = evalNode(item, record, actor);
      if (!res.supported) return res;
      if (truthy(res.value)) return const EvalOutcome.supported(true);
    }
    return const EvalOutcome.supported(false);
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
    if (tuple.length != 3) return const EvalOutcome.unsupported();
    final left = evalNode(tuple[1], record, actor);
    if (!left.supported) return left;
    final right = evalNode(tuple[2], record, actor);
    if (!right.supported) return right;
    return EvalOutcome.supported(compare(op, left.value, right.value));
  }

  return const EvalOutcome.unsupported();
}

Object? resolvePath(
  String path, [
  Map<String, dynamic>? record,
  Map<String, dynamic>? actor,
]) {
  if (path.startsWith('actor.')) {
    return resolveBind(path.substring(6), actor ?? const {});
  }
  if (path.startsWith('record.')) {
    return resolveBind(path.substring(7), record ?? const {});
  }
  return resolveBind(path, record ?? const {});
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
  final outcome = evalNode(when, record, null);
  if (!outcome.supported) return (false, 'GUARD_UNSUPPORTED');
  if (!truthy(outcome.value)) return (false, 'GUARD_FAILED');
  return (true, '');
}

EvalOutcome evalCondition(
  Object? cond, [
  Map<String, dynamic>? record,
  Map<String, dynamic>? actor,
]) {
  if (cond == null) return const EvalOutcome.supported(true);
  if (cond is String) {
    final parsed = parseCondition(cond);
    if (!parsed.$1) return const EvalOutcome.unsupported();
    return evalNode(parsed.$2, record, actor);
  }
  return evalNode(cond, record, actor);
}

enum _TokenType {
  eof,
  ident,
  str,
  number,
  boolean,
  nullVal,
  op,
  lparen,
  rparen,
}

class _Token {
  final _TokenType type;
  final Object? val;
  final String raw;

  const _Token(this.type, this.val, this.raw);
}

(bool, Object?) parseCondition(String src) {
  final s = src.trim();
  if (s.isEmpty) return (false, null);

  final tokens = <_Token>[];
  var i = 0;
  final n = s.length;

  while (i < n) {
    final ch = s[i];
    if (ch == ' ' || ch == '\t' || ch == '\n' || ch == '\r') {
      i++;
      continue;
    }

    if (ch == '(') {
      tokens.add(const _Token(_TokenType.lparen, null, '('));
      i++;
      continue;
    }
    if (ch == ')') {
      tokens.add(const _Token(_TokenType.rparen, null, ')'));
      i++;
      continue;
    }

    // String literals
    if (ch == '\'' || ch == '"') {
      final quote = ch;
      i++;
      final buf = StringBuffer();
      while (i < n && s[i] != quote) {
        if (s[i] == '\\' && i + 1 < n) {
          buf.write(s[i + 1]);
          i += 2;
        } else {
          buf.write(s[i]);
          i++;
        }
      }
      if (i >= n) return (false, null);
      i++; // skip closing quote
      final val = buf.toString();
      tokens.add(_Token(_TokenType.str, val, val));
      continue;
    }

    // Two-character operators
    if (i + 1 < n) {
      final two = s.substring(i, i + 2);
      if (two == '==' ||
          two == '!=' ||
          two == '<=' ||
          two == '>=' ||
          two == '&&' ||
          two == '||') {
        tokens.add(_Token(_TokenType.op, two, two));
        i += 2;
        continue;
      }
    }

    // Single-character operators
    if (ch == '<' || ch == '>' || ch == '!') {
      tokens.add(_Token(_TokenType.op, ch, ch));
      i++;
      continue;
    }

    // Numbers
    final isDigit = ch.codeUnitAt(0) >= 48 && ch.codeUnitAt(0) <= 57;
    final isNegNum = ch == '-' && i + 1 < n && s.codeUnitAt(i + 1) >= 48 && s.codeUnitAt(i + 1) <= 57;
    if (isDigit || isNegNum) {
      final start = i;
      if (ch == '-') i++;
      var hasDot = false;
      while (i < n) {
        final c = s[i];
        final isD = c.codeUnitAt(0) >= 48 && c.codeUnitAt(0) <= 57;
        if (isD) {
          i++;
        } else if (c == '.' && !hasDot) {
          hasDot = true;
          i++;
        } else {
          break;
        }
      }
      final numStr = s.substring(start, i);
      final numVal = num.tryParse(numStr);
      if (numVal == null) return (false, null);
      tokens.add(_Token(_TokenType.number, numVal, numStr));
      continue;
    }

    // Identifiers and keywords
    final isAlpha = (ch.codeUnitAt(0) >= 65 && ch.codeUnitAt(0) <= 90) ||
        (ch.codeUnitAt(0) >= 97 && ch.codeUnitAt(0) <= 122) ||
        ch == '_';
    if (isAlpha) {
      final start = i;
      while (i < n) {
        final c = s[i];
        final isA = (c.codeUnitAt(0) >= 65 && c.codeUnitAt(0) <= 90) ||
            (c.codeUnitAt(0) >= 97 && c.codeUnitAt(0) <= 122) ||
            (c.codeUnitAt(0) >= 48 && c.codeUnitAt(0) <= 57) ||
            c == '_' ||
            c == '.';
        if (isA) {
          i++;
        } else {
          break;
        }
      }
      final ident = s.substring(start, i);
      switch (ident) {
        case 'true':
          tokens.add(_Token(_TokenType.boolean, true, ident));
          break;
        case 'false':
          tokens.add(_Token(_TokenType.boolean, false, ident));
          break;
        case 'null':
        case 'nil':
          tokens.add(_Token(_TokenType.nullVal, null, ident));
          break;
        case 'and':
          tokens.add(const _Token(_TokenType.op, '&&', '&&'));
          break;
        case 'or':
          tokens.add(const _Token(_TokenType.op, '||', '||'));
          break;
        case 'not':
          tokens.add(const _Token(_TokenType.op, '!', '!'));
          break;
        default:
          tokens.add(_Token(_TokenType.ident, ident, ident));
      }
      continue;
    }

    return (false, null);
  }

  tokens.add(const _Token(_TokenType.eof, null, ''));

  final parser = _ConditionParser(tokens);
  final ast = parser.parseOr();
  if (ast == null || parser.peek().type != _TokenType.eof) {
    return (false, null);
  }
  return (true, ast);
}

class _ConditionParser {
  final List<_Token> tokens;
  var pos = 0;

  _ConditionParser(this.tokens);

  _Token peek() => pos < tokens.length ? tokens[pos] : const _Token(_TokenType.eof, null, '');

  _Token next() {
    final t = peek();
    if (pos < tokens.length) pos++;
    return t;
  }

  Object? parseOr() {
    var left = parseAnd();
    if (left == null) return null;
    while (peek().type == _TokenType.op && peek().raw == '||') {
      next();
      final right = parseAnd();
      if (right == null) return null;
      left = ['or', left, right];
    }
    return left;
  }

  Object? parseAnd() {
    var left = parseComparison();
    if (left == null) return null;
    while (peek().type == _TokenType.op && peek().raw == '&&') {
      next();
      final right = parseComparison();
      if (right == null) return null;
      left = ['and', left, right];
    }
    return left;
  }

  Object? parseComparison() {
    final left = parsePrimary();
    if (left == null) return null;
    final tok = peek();
    if (tok.type == _TokenType.op &&
        (tok.raw == '==' ||
            tok.raw == '!=' ||
            tok.raw == '<' ||
            tok.raw == '<=' ||
            tok.raw == '>' ||
            tok.raw == '>=')) {
      next();
      final right = parsePrimary();
      if (right == null) return null;
      return [tok.raw, left, right];
    }
    return left;
  }

  Object? parsePrimary() {
    final tok = peek();
    if (tok.type == _TokenType.op && tok.raw == '!') {
      next();
      final inner = parsePrimary();
      if (inner == null) return null;
      return ['!', inner];
    }
    if (tok.type == _TokenType.lparen) {
      next();
      final inner = parseOr();
      if (inner == null || peek().type != _TokenType.rparen) return null;
      next();
      return inner;
    }
    if (tok.type == _TokenType.str ||
        tok.type == _TokenType.number ||
        tok.type == _TokenType.boolean ||
        tok.type == _TokenType.nullVal) {
      next();
      return tok.val;
    }
    if (tok.type == _TokenType.ident) {
      next();
      final ident = tok.raw;
      if (ident.startsWith('actor.')) {
        return ['actor', ident.substring(6)];
      }
      if (ident.startsWith('record.')) {
        return ['get', ident.substring(7)];
      }
      return ['get', ident];
    }
    return null;
  }
}
