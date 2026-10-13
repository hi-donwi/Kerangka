"""Subset of the K1 evaluator (spec/semantics/expressions.md).

Guards in a compiled model are AST nodes. This evaluates the comparisons and boolean
connectives a guard is written in. An operator outside that subset is unsupported: the
caller must refuse it, not treat it as false and continue.
"""

from typing import Any, Dict, Optional, Tuple


def eval_expr(node: Any, record: Optional[Dict[str, Any]]) -> Tuple[bool, Any]:
    if not isinstance(node, dict):
        return False, None
    if "literal" in node:
        return True, node["literal"]
    if "$bind" in node:
        path = node["$bind"]
        if not isinstance(path, str):
            return False, None
        return True, _resolve(path, record or {})
    op = node.get("$expr")
    if not isinstance(op, str):
        return False, None
    args = node.get("args")
    if not isinstance(args, list):
        args = []
    return _call(op, args, record or {})


def _call(op: str, args: list, record: Dict[str, Any]) -> Tuple[bool, Any]:
    if op in ("!", "not"):
        if len(args) != 1:
            return False, None
        supported, value = eval_expr(args[0], record)
        if not supported:
            return False, None
        return True, not _truthy(value)
    if op in ("&&", "and", "||", "or"):
        if len(args) != 2:
            return False, None
        supported, left = eval_expr(args[0], record)
        if not supported:
            return False, None
        if op in ("&&", "and"):
            if not _truthy(left):
                return True, left
        elif _truthy(left):
            return True, left
        return eval_expr(args[1], record)
    if op in ("==", "eq", "!=", "neq", "<", "<=", ">", ">=", "lt", "lte", "gt", "gte"):
        if len(args) != 2:
            return False, None
        left_ok, left = eval_expr(args[0], record)
        if not left_ok:
            return False, None
        right_ok, right = eval_expr(args[1], record)
        if not right_ok:
            return False, None
        return True, _compare(op, left, right)
    return False, None


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


def _resolve(path: str, record: Dict[str, Any]) -> Any:
    if path in record:
        return record[path]
    current: Any = record
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
