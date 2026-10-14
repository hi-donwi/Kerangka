"""Subset of the K1 evaluator (spec/semantics/expressions.md, ADR-0008, ADR-0040, ADR-0044).

Guards and read filters in a compiled model are AST nodes or lowered tuples.
Permission conditions can be string expressions (PLAN.md §5.1), AST nodes, or tuples.
This evaluates comparisons, boolean connectives, field accesses, and actor properties.
An operator or syntax outside that subset is unsupported: the caller must refuse it
(fail closed), not treat it as false or permissive and continue.
"""

from typing import Any, Dict, List, Optional, Tuple


def eval_expr(node: Any, record: Optional[Dict[str, Any]] = None) -> Tuple[bool, Any]:
    return eval_node(node, record, None)


def eval_node(
    node: Any,
    record: Optional[Dict[str, Any]] = None,
    actor: Optional[Dict[str, Any]] = None,
) -> Tuple[bool, Any]:
    if node is None:
        return True, None

    if isinstance(node, dict):
        if "literal" in node:
            return True, node["literal"]
        if "$bind" in node:
            path = node["$bind"]
            if not isinstance(path, str):
                return False, None
            return True, _resolve_path(path, record, actor)
        op = node.get("$expr")
        if not isinstance(op, str):
            return False, None
        args = node.get("args")
        if not isinstance(args, list):
            args = []
        return _call(op, args, record, actor)

    if isinstance(node, (list, tuple)):
        return _eval_tuple(list(node), record, actor)

    if isinstance(node, (str, bool, int, float)):
        return True, node

    return False, None


def _call(
    op: str,
    args: list,
    record: Optional[Dict[str, Any]],
    actor: Optional[Dict[str, Any]],
) -> Tuple[bool, Any]:
    if op in ("!", "not"):
        if len(args) != 1:
            return False, None
        supported, value = eval_node(args[0], record, actor)
        if not supported:
            return False, None
        return True, not _truthy(value)

    if op in ("&&", "and", "||", "or"):
        if len(args) != 2:
            return False, None
        supported, left = eval_node(args[0], record, actor)
        if not supported:
            return False, None
        if op in ("&&", "and"):
            if not _truthy(left):
                return True, left
        elif _truthy(left):
            return True, left
        return eval_node(args[1], record, actor)

    if op in ("==", "eq", "!=", "neq", "<", "<=", ">", ">=", "lt", "lte", "gt", "gte"):
        if len(args) != 2:
            return False, None
        left_ok, left = eval_node(args[0], record, actor)
        if not left_ok:
            return False, None
        right_ok, right = eval_node(args[1], record, actor)
        if not right_ok:
            return False, None
        return True, _compare(op, left, right)

    return False, None


def _eval_tuple(
    tuple_node: list,
    record: Optional[Dict[str, Any]],
    actor: Optional[Dict[str, Any]],
) -> Tuple[bool, Any]:
    if not tuple_node or not isinstance(tuple_node[0], str):
        return False, None

    op = tuple_node[0]

    if op == "literal":
        if len(tuple_node) != 2:
            return False, None
        return True, tuple_node[1]

    if op == "get":
        if len(tuple_node) < 2:
            return False, None
        path = ".".join(str(x) for x in tuple_node[1:])
        return True, _resolve(path, record or {})

    if op == "actor":
        if len(tuple_node) < 2:
            return False, None
        path = ".".join(str(x) for x in tuple_node[1:])
        return True, _resolve(path, actor or {})

    if op == "is_null":
        if len(tuple_node) != 2:
            return False, None
        ok, val = eval_node(tuple_node[1], record, actor)
        if not ok:
            return False, None
        return True, val is None

    if op in ("!", "not"):
        if len(tuple_node) != 2:
            return False, None
        ok, val = eval_node(tuple_node[1], record, actor)
        if not ok:
            return False, None
        return True, not _truthy(val)

    if op in ("&&", "and"):
        if len(tuple_node) < 2:
            return False, None
        for item in tuple_node[1:]:
            ok, val = eval_node(item, record, actor)
            if not ok:
                return False, None
            if not _truthy(val):
                return True, False
        return True, True

    if op in ("||", "or"):
        if len(tuple_node) < 2:
            return False, None
        for item in tuple_node[1:]:
            ok, val = eval_node(item, record, actor)
            if not ok:
                return False, None
            if _truthy(val):
                return True, True
        return True, False

    if op in ("==", "eq", "!=", "neq", "<", "<=", ">", ">=", "lt", "lte", "gt", "gte"):
        if len(tuple_node) != 3:
            return False, None
        lok, left = eval_node(tuple_node[1], record, actor)
        if not lok:
            return False, None
        rok, right = eval_node(tuple_node[2], record, actor)
        if not rok:
            return False, None
        return True, _compare(op, left, right)

    return False, None


def _resolve_path(
    path: str,
    record: Optional[Dict[str, Any]],
    actor: Optional[Dict[str, Any]],
) -> Any:
    if path.startswith("actor."):
        return _resolve(path[6:], actor or {})
    if path.startswith("record."):
        return _resolve(path[7:], record or {})
    return _resolve(path, record or {})


def _compare(op: str, left: Any, right: Any) -> bool:
    if op in ("==", "eq"):
        if left is None and right is None:
            return True
        if left is None or right is None:
            return False
        ln, rn = _as_float(left), _as_float(right)
        if ln is not None and rn is not None:
            return ln == rn
        return left == right

    if op in ("!=", "neq"):
        if left is None and right is None:
            return False
        if left is None or right is None:
            return True
        ln, rn = _as_float(left), _as_float(right)
        if ln is not None and rn is not None:
            return ln != rn
        return left != right

    if left is None or right is None:
        return False

    ln, rn = _as_float(left), _as_float(right)
    if ln is not None and rn is not None:
        return _order(op, ln, rn)

    if isinstance(left, str) and isinstance(right, str):
        return _order(op, left, right)

    return False


def _order(op: str, left: Any, right: Any) -> bool:
    if op in ("<", "lt"):
        return left < right
    if op in ("<=", "lte"):
        return left <= right
    if op in (">", "gt"):
        return left > right
    if op in (">=", "gte"):
        return left >= right
    return False


def _resolve(path: str, obj: Dict[str, Any]) -> Any:
    if not isinstance(obj, dict):
        return None
    if path in obj:
        return obj[path]
    current: Any = obj
    for seg in path.split("."):
        if not isinstance(current, dict) or seg not in current:
            return None
        current = current[seg]
    return current


def _truthy(value: Any) -> bool:
    if value is None or value is False:
        return False
    if value == "" or value == 0:
        return False
    return True


def _as_float(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def guard_allows(when: Any, record: Dict[str, Any]) -> Tuple[bool, str]:
    if when is None:
        return True, ""
    supported, value = eval_expr(when, record)
    if not supported:
        return False, "GUARD_UNSUPPORTED"
    if not _truthy(value):
        return False, "GUARD_FAILED"
    return True, ""


def eval_condition(
    cond: Any,
    record: Optional[Dict[str, Any]] = None,
    actor: Optional[Dict[str, Any]] = None,
) -> Tuple[bool, Any]:
    if cond is None:
        return True, True
    if isinstance(cond, str):
        ok, ast = parse_condition(cond)
        if not ok:
            return False, None
        return eval_node(ast, record, actor)
    return eval_node(cond, record, actor)


class _Parser:
    def __init__(self, tokens: List[Tuple[str, Any, str]]):
        self.tokens = tokens
        self.pos = 0

    def peek(self) -> Tuple[str, Any, str]:
        if self.pos < len(self.tokens):
            return self.tokens[self.pos]
        return ("EOF", None, "")

    def next(self) -> Tuple[str, Any, str]:
        tok = self.peek()
        if self.pos < len(self.tokens):
            self.pos += 1
        return tok

    def parse_or(self) -> Optional[Any]:
        left = self.parse_and()
        if left is None:
            return None
        while self.peek()[0] == "OP" and self.peek()[2] == "||":
            self.next()
            right = self.parse_and()
            if right is None:
                return None
            left = ["or", left, right]
        return left

    def parse_and(self) -> Optional[Any]:
        left = self.parse_comparison()
        if left is None:
            return None
        while self.peek()[0] == "OP" and self.peek()[2] == "&&":
            self.next()
            right = self.parse_comparison()
            if right is None:
                return None
            left = ["and", left, right]
        return left

    def parse_comparison(self) -> Optional[Any]:
        left = self.parse_primary()
        if left is None:
            return None
        tok = self.peek()
        if tok[0] == "OP" and tok[2] in ("==", "!=", "<", "<=", ">", ">="):
            self.next()
            right = self.parse_primary()
            if right is None:
                return None
            return [tok[2], left, right]
        return left

    def parse_primary(self) -> Optional[Any]:
        tok = self.peek()
        if tok[0] == "OP" and tok[2] == "!":
            self.next()
            inner = self.parse_primary()
            if inner is None:
                return None
            return ["!", inner]
        if tok[0] == "LPAREN":
            self.next()
            inner = self.parse_or()
            if inner is None or self.peek()[0] != "RPAREN":
                return None
            self.next()
            return inner
        if tok[0] in ("STRING", "NUMBER", "BOOL", "NULL"):
            self.next()
            return tok[1]
        if tok[0] == "IDENT":
            self.next()
            ident = tok[2]
            if ident.startswith("actor."):
                return ["actor", ident[6:]]
            if ident.startswith("record."):
                return ["get", ident[7:]]
            return ["get", ident]
        return None


def parse_condition(src: str) -> Tuple[bool, Any]:
    s = src.strip()
    if not s:
        return False, None

    tokens: List[Tuple[str, Any, str]] = []
    i = 0
    n = len(s)

    while i < n:
        ch = s[i]
        if ch.isspace():
            i += 1
            continue

        if ch == "(":
            tokens.append(("LPAREN", None, "("))
            i += 1
            continue
        if ch == ")":
            tokens.append(("RPAREN", None, ")"))
            i += 1
            continue

        # Strings
        if ch in ("'", '"'):
            quote = ch
            i += 1
            start = i
            chars = []
            while i < n and s[i] != quote:
                if s[i] == "\\" and i + 1 < n:
                    chars.append(s[i + 1])
                    i += 2
                else:
                    chars.append(s[i])
                    i += 1
            if i >= n:
                return False, None
            i += 1
            val = "".join(chars)
            tokens.append(("STRING", val, val))
            continue

        # Two-character operators
        if i + 1 < n:
            two = s[i : i + 2]
            if two in ("==", "!=", "<=", ">=", "&&", "||"):
                tokens.append(("OP", two, two))
                i += 2
                continue

        # Single-character operators
        if ch in ("<", ">", "!"):
            tokens.append(("OP", ch, ch))
            i += 1
            continue

        # Numbers
        if ch.isdigit() or (ch == "-" and i + 1 < n and s[i + 1].isdigit()):
            start = i
            if ch == "-":
                i += 1
            has_dot = False
            while i < n and (s[i].isdigit() or s[i] == "."):
                if s[i] == ".":
                    if has_dot:
                        return False, None
                    has_dot = True
                i += 1
            num_str = s[start:i]
            try:
                val = float(num_str) if "." in num_str else int(num_str)
                tokens.append(("NUMBER", val, num_str))
                continue
            except ValueError:
                return False, None

        # Identifiers
        if ch.isalpha() or ch == "_":
            start = i
            while i < n and (s[i].isalnum() or s[i] in ("_", ".")):
                i += 1
            ident = s[start:i]
            if ident == "true":
                tokens.append(("BOOL", True, ident))
            elif ident == "false":
                tokens.append(("BOOL", False, ident))
            elif ident in ("null", "nil", "None"):
                tokens.append(("NULL", None, ident))
            elif ident == "and":
                tokens.append(("OP", "&&", "&&"))
            elif ident == "or":
                tokens.append(("OP", "||", "||"))
            elif ident == "not":
                tokens.append(("OP", "!", "!"))
            else:
                tokens.append(("IDENT", ident, ident))
            continue

        return False, None

    tokens.append(("EOF", None, ""))
    parser = _Parser(tokens)
    ast = parser.parse_or()
    if ast is None or parser.peek()[0] != "EOF":
        return False, None
    return True, ast
