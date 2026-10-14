import 'dart:math' as math;

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

  if (op == 'abs') {
    if (args.length != 1) return const EvalOutcome.unsupported();
    final res = evalNode(args[0], record, actor);
    if (!res.supported) return res;
    if (res.value == null) return const EvalOutcome.supported(null);
    if (res.value is num) return EvalOutcome.supported((res.value as num).abs());
    return const EvalOutcome.unsupported();
  }

  if (op == 'round') {
    if (args.isEmpty || args.length > 2) return const EvalOutcome.unsupported();
    final res = evalNode(args[0], record, actor);
    if (!res.supported) return res;
    if (res.value == null) return const EvalOutcome.supported(null);
    if (res.value is! num) return const EvalOutcome.unsupported();
    var decimals = 0;
    if (args.length == 2) {
      final decRes = evalNode(args[1], record, actor);
      if (!decRes.supported) return decRes;
      if (decRes.value is num) decimals = (decRes.value as num).toInt();
    }
    final factor = math.pow(10, decimals);
    return EvalOutcome.supported(((res.value as num) * factor).round() / factor);
  }

  if (op == 'ceil' || op == 'floor') {
    if (args.length != 1) return const EvalOutcome.unsupported();
    final res = evalNode(args[0], record, actor);
    if (!res.supported) return res;
    if (res.value == null) return const EvalOutcome.supported(null);
    if (res.value is num) {
      final n = res.value as num;
      return EvalOutcome.supported(op == 'ceil' ? n.ceil() : n.floor());
    }
    return const EvalOutcome.unsupported();
  }

  if (op == 'min' || op == 'max') {
    if (args.length != 2) return const EvalOutcome.unsupported();
    final a = evalNode(args[0], record, actor);
    if (!a.supported) return a;
    final b = evalNode(args[1], record, actor);
    if (!b.supported) return b;
    if (a.value == null || b.value == null) return const EvalOutcome.supported(null);
    if (a.value is num && b.value is num) {
      final aNum = a.value as num;
      final bNum = b.value as num;
      return EvalOutcome.supported(op == 'min' ? math.min(aNum, bNum) : math.max(aNum, bNum));
    }
    return const EvalOutcome.unsupported();
  }

  if (op == 'lower' || op == 'upper' || op == 'trim') {
    if (args.length != 1) return const EvalOutcome.unsupported();
    final res = evalNode(args[0], record, actor);
    if (!res.supported) return res;
    if (res.value == null) return const EvalOutcome.supported(null);
    final s = res.value.toString();
    if (op == 'lower') return EvalOutcome.supported(s.toLowerCase());
    if (op == 'upper') return EvalOutcome.supported(s.toUpperCase());
    return EvalOutcome.supported(s.trim());
  }

  if (op == 'len') {
    if (args.length != 1) return const EvalOutcome.unsupported();
    final res = evalNode(args[0], record, actor);
    if (!res.supported) return res;
    if (res.value == null) return const EvalOutcome.supported(0);
    if (res.value is String) return EvalOutcome.supported((res.value as String).length);
    if (res.value is List) return EvalOutcome.supported((res.value as List).length);
    if (res.value is Map) return EvalOutcome.supported((res.value as Map).length);
    return const EvalOutcome.supported(0);
  }

  if (op == 'contains') {
    if (args.length != 2) return const EvalOutcome.unsupported();
    final h = evalNode(args[0], record, actor);
    if (!h.supported) return h;
    final n = evalNode(args[1], record, actor);
    if (!n.supported) return n;
    if (h.value == null || n.value == null) return const EvalOutcome.supported(false);
    if (h.value is String) return EvalOutcome.supported((h.value as String).contains(n.value.toString()));
    if (h.value is List) return EvalOutcome.supported((h.value as List).contains(n.value));
    return const EvalOutcome.supported(false);
  }

  if (op == 'startsWith') {
    if (args.length != 2) return const EvalOutcome.unsupported();
    final s = evalNode(args[0], record, actor);
    if (!s.supported) return s;
    final p = evalNode(args[1], record, actor);
    if (!p.supported) return p;
    if (s.value == null || p.value == null) return const EvalOutcome.supported(false);
    return EvalOutcome.supported(s.value.toString().startsWith(p.value.toString()));
  }

  if (op == 'concat') {
    final sb = StringBuffer();
    for (final arg in args) {
      final res = evalNode(arg, record, actor);
      if (!res.supported) return res;
      if (res.value == null) return const EvalOutcome.supported(null);
      sb.write(res.value.toString());
    }
    return EvalOutcome.supported(sb.toString());
  }

  if (op == 'coalesce') {
    for (final arg in args) {
      final res = evalNode(arg, record, actor);
      if (!res.supported) return res;
      if (res.value != null) return EvalOutcome.supported(res.value);
    }
    return const EvalOutcome.supported(null);
  }

  if (op == 'in') {
    if (args.length != 2) return const EvalOutcome.unsupported();
    final item = evalNode(args[0], record, actor);
    if (!item.supported) return item;
    final list = evalNode(args[1], record, actor);
    if (!list.supported) return list;
    if (item.value == null || list.value == null) return const EvalOutcome.supported(false);
    if (list.value is List) return EvalOutcome.supported((list.value as List).contains(item.value));
    return const EvalOutcome.supported(false);
  }

  if (op == 'isSet') {
    if (args.length != 1) return const EvalOutcome.unsupported();
    final res = evalNode(args[0], record, actor);
    if (!res.supported) return res;
    return EvalOutcome.supported(res.value != null);
  }

  if (op == 'is_null') {
    if (args.length != 1) return const EvalOutcome.unsupported();
    final res = evalNode(args[0], record, actor);
    if (!res.supported) return res;
    return EvalOutcome.supported(res.value == null);
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

  return evalCall(op, tuple.skip(1).toList(), record, actor);
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
