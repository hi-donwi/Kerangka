"""
Kerangka Reference Engine in Python.
Specification Version: 0.1
Status: Draft
License: Apache-2.0
"""

from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field
import datetime
import re

from .eval import guard_allows, eval_condition, eval_node, _truthy

DECIMAL_WIRE = re.compile(r"^-?\d+(\.\d+)?$")
RANGE_PATTERN = re.compile(r"^([\[(])\s*([0-9.]+)\s*\.\.\s*([0-9.]+)\s*([\])])$")


def _field_type_name(def_val: Any) -> str:
    if isinstance(def_val, str):
        parts = def_val.strip().split()
        if parts:
            clean = parts[0].rstrip("!")
            idx = clean.find("(")
            if idx != -1:
                clean = clean[:idx]
            return clean.lower()
    elif isinstance(def_val, dict):
        t = def_val.get("type")
        if isinstance(t, str):
            return t.lower()
    return ""



@dataclass
class Decision:
    allowed: bool
    code: Optional[str] = None
    reason: Optional[str] = None


@dataclass
class ReadScope:
    allowed: bool
    code: Optional[str] = None
    reason: Optional[str] = None
    where: Optional[Any] = None


@dataclass
class ValidationErrorItem:
    message: str
    field: Optional[str] = None
    code: str = "VALIDATION_ERROR"


@dataclass
class ValidationResult:
    valid: bool
    errors: List[ValidationErrorItem] = field(default_factory=list)


@dataclass
class ExecutionResult:
    ok: bool
    record: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    message: Optional[str] = None
    events: List[Dict[str, Any]] = field(default_factory=list)


class ReferenceEngine:
    """Pure in-memory reference execution engine for Kerangka models in Python."""

    def __init__(self, kir_document: Dict[str, Any]):
        self.doc = kir_document
        self.entities = kir_document.get("entities", {})

    def can_operate(
        self,
        entity_name: str,
        operation: str,
        actor: Optional[Dict[str, Any]] = None,
        record: Optional[Dict[str, Any]] = None,
    ) -> Decision:
        entity = self.entities.get(entity_name)
        if not entity:
            return Decision(allowed=False, code="UNKNOWN_ENTITY", reason=f"Unknown entity '{entity_name}'")

        permissions = entity.get("permissions")
        if not isinstance(permissions, dict) or operation not in permissions:
            return Decision(allowed=True)

        declared = permissions[operation]
        roles = (actor or {}).get("roles", [])
        if not isinstance(roles, list):
            roles = []

        if isinstance(declared, list):
            if any(r in roles for r in declared):
                return Decision(allowed=True)
            if len(declared) == 0:
                return Decision(
                    allowed=False,
                    code="PERMISSION_DENIED",
                    reason=f"'{operation}' on '{entity_name}' is granted to no role",
                )
            return Decision(
                allowed=False,
                code="PERMISSION_DENIED",
                reason=f"'{operation}' on '{entity_name}' requires one of {declared}",
            )

        if isinstance(declared, dict):
            conditions = []
            for role, value in declared.items():
                if role not in roles:
                    continue
                if value is True:
                    return Decision(allowed=True)
                if value is False:
                    continue
                conditions.append(value)

            if conditions:
                if record is None:
                    return Decision(
                        allowed=False,
                        code="PERMISSION_NEEDS_RECORD",
                        reason=f"'{operation}' on '{entity_name}' is granted to this actor only under a condition on the record",
                    )
                for cond in conditions:
                    ok, val = eval_condition(cond, record, actor)
                    if ok and _truthy(val):
                        return Decision(allowed=True)
                return Decision(
                    allowed=False,
                    code="PERMISSION_DENIED",
                    reason=f"'{operation}' on '{entity_name}' condition evaluated to false or unsupported",
                )

            return Decision(
                allowed=False,
                code="PERMISSION_DENIED",
                reason=f"'{operation}' on '{entity_name}' is not granted to this actor",
            )

        return Decision(
            allowed=False,
            code="PERMISSION_DENIED",
            reason=f"'{operation}' on '{entity_name}' has a permission this engine cannot read",
        )

    def authorize(
        self,
        entity_name: str,
        operation: str,
        roles: Optional[List[str]] = None,
    ) -> Decision:
        dec = self.can_operate(entity_name, operation, {"roles": roles or []}, None)
        if dec.code == "PERMISSION_NEEDS_RECORD":
            return Decision(allowed=False, code="UNSUPPORTED", reason=dec.reason)
        return dec

    def authorize_read(
        self,
        entity_name: str,
        actor: Optional[Dict[str, Any]] = None,
    ) -> ReadScope:
        entity = self.entities.get(entity_name)
        if not entity:
            return ReadScope(
                allowed=False,
                code="UNKNOWN_ENTITY",
                reason=f"Entity '{entity_name}' is not in the model, so nothing is known about who may read it",
            )

        conditions: List[Any] = []
        fields = entity.get("fields", {})
        multitenancy = self.doc.get("multitenancy")
        is_tenant_scoped = ("tenantId" in fields) or (multitenancy is not None)

        if is_tenant_scoped:
            tenant_id = (actor or {}).get("tenantId")
            if tenant_id is None:
                return ReadScope(
                    allowed=False,
                    code="PERMISSION_DENIED",
                    reason=f"'{entity_name}' is tenant-scoped and the request established no tenant.",
                )
            conditions.append(["==", ["get", "tenantId"], tenant_id])

        traits = entity.get("traits", [])
        is_soft_delete = (
            "std:softDelete" in traits
            or "deleted" in fields
            or "deletedAt" in fields
        )
        if is_soft_delete:
            if "deleted" in fields:
                conditions.append(["==", ["get", "deleted"], False])
            elif "deletedAt" in fields:
                conditions.append(["is_null", ["get", "deletedAt"]])

        declared = entity.get("readFilter")
        if isinstance(declared, str) and declared:
            return ReadScope(
                allowed=False,
                code="READ_FILTER_NOT_COMPILED",
                reason=f"The readFilter on '{entity_name}' is still a string, so it was never lowered and would be ignored.",
            )
        if isinstance(declared, list) and declared:
            conditions.append(declared)

        if not conditions:
            return ReadScope(allowed=True, where=None)
        if len(conditions) == 1:
            return ReadScope(allowed=True, where=conditions[0])
        return ReadScope(allowed=True, where=["and"] + conditions)

    def read_filter(
        self,
        entity_name: str,
        actor: Optional[Dict[str, Any]] = None,
    ) -> Optional[Any]:
        scope = self.authorize_read(entity_name, actor)
        return scope.where if scope.allowed else None

    def eval_filter(
        self,
        predicate: Any,
        record: Optional[Dict[str, Any]],
        actor: Optional[Dict[str, Any]] = None,
    ) -> bool:
        if predicate is None:
            return True
        ok, val = eval_node(predicate, record, actor)
        return ok and _truthy(val)

    def has_read_filter(self, entity_name: str) -> bool:
        return self.entities.get(entity_name, {}).get("readFilter") is not None

    def decode_record(self, entity_name: str, record: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        if record is None:
            return None
        entity = self.entities.get(entity_name, {})
        fields = entity.get("fields", {})
        return self._decode_fields(fields, record, 0)

    def _decode_fields(self, defs: Dict[str, Any], record: Dict[str, Any], depth: int) -> Dict[str, Any]:
        if depth > 16 or not isinstance(record, dict):
            return record
        out = dict(record)
        for name, field_def in defs.items():
            if name not in out or out[name] is None:
                continue
            out[name] = self._decode_value(field_def, out[name], depth + 1)
        return out

    def _decode_value(self, def_val: Any, val: Any, depth: int) -> Any:
        tname = _field_type_name(def_val)
        if tname == "decimal":
            if isinstance(val, str) and DECIMAL_WIRE.match(val.strip()):
                try:
                    return float(val.strip())
                except ValueError:
                    return val
            return val
        if tname == "list":
            if isinstance(val, list):
                elem_def = def_val.get("element") if isinstance(def_val, dict) else None
                if elem_def is not None:
                    return [self._decode_value(elem_def, item, depth + 1) for item in val]
            return val

        target = tname
        if isinstance(def_val, dict) and def_val.get("target"):
            target = str(def_val["target"]).lower()

        if target and isinstance(val, dict):
            target_entity = self.entities.get(target)
            if target_entity and target_entity.get("embedded"):
                return self._decode_fields(target_entity.get("fields", {}), val, depth)

        return val

    def evaluate_decision(
        self,
        table_or_name: Any,
        input_data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        if input_data is None:
            input_data = {}

        table_def: Optional[Dict[str, Any]] = None
        table_name: str = ""

        if isinstance(table_or_name, str):
            table_name = table_or_name
            decisions = self.doc.get("decisions", {})
            if isinstance(decisions, dict):
                table_def = decisions.get(table_or_name)
        elif isinstance(table_or_name, dict):
            table_def = table_or_name
            table_name = table_def.get("name", "")

        if not table_def or not isinstance(table_def, dict):
            target_name = table_name or str(table_or_name)
            return {
                "matched": False,
                "hit_count": 0,
                "error": f"Decision table '{target_name}' not found",
                "code": "TABLE_NOT_FOUND",
            }

        if not table_name:
            table_name = table_def.get("name", "")

        inputs = table_def.get("inputs", [])
        outputs = table_def.get("outputs", [])
        hit_policy = str(table_def.get("hitPolicy", "first")).lower()

        rules = self._parse_decision_rules(table_def, inputs, outputs)
        matching_outputs: List[Dict[str, Any]] = []

        for rule in rules:
            rule_matched = True
            rule_inputs = rule.get("inputs", [])

            for i, col in enumerate(inputs):
                col_name = col.get("name")
                cell = rule_inputs[i] if i < len(rule_inputs) else "-"
                val = input_data.get(col_name)

                if not self._match_decision_cell(cell, val):
                    rule_matched = False
                    break

            if rule_matched:
                resolved = self._resolve_decision_outputs(rule.get("outputs", {}), outputs, input_data)
                matching_outputs.append(resolved)
                if hit_policy == "first":
                    break

        if len(matching_outputs) == 0:
            return {
                "matched": False,
                "hit_count": 0,
                "error": f"Decision table '{table_name}' matched no row",
                "code": "DECISION_NO_MATCH",
            }

        if hit_policy == "unique":
            if len(matching_outputs) > 1:
                return {
                    "matched": False,
                    "hit_count": len(matching_outputs),
                    "error": f"Unique hit policy violated: {len(matching_outputs)} rules matched in '{table_name}'",
                    "code": "UNIQUE_VIOLATION",
                }
            return {
                "matched": True,
                "hit_count": 1,
                "outputs": matching_outputs[0],
            }

        if hit_policy == "collect":
            return {
                "matched": True,
                "hit_count": len(matching_outputs),
                "outputs": matching_outputs,
            }

        return {
            "matched": True,
            "hit_count": len(matching_outputs),
            "outputs": matching_outputs[0],
        }

    decide = evaluate_decision

    def _match_decision_cell(self, cell: Any, val: Any) -> bool:
        if cell is None or cell == "-":
            return True

        if isinstance(cell, str):
            trimmed = cell.strip()
            if trimmed == "-" or trimmed == "":
                return True

            is_num = isinstance(val, (int, float)) and not isinstance(val, bool)
            val_num = float(val) if is_num else 0.0

            if trimmed.startswith(">=") and is_num:
                try:
                    return val_num >= float(trimmed[2:].strip())
                except ValueError:
                    return False
            if trimmed.startswith(">") and is_num:
                try:
                    return val_num > float(trimmed[1:].strip())
                except ValueError:
                    return False
            if trimmed.startswith("<=") and is_num:
                try:
                    return val_num <= float(trimmed[2:].strip())
                except ValueError:
                    return False
            if trimmed.startswith("<") and is_num:
                try:
                    return val_num < float(trimmed[1:].strip())
                except ValueError:
                    return False

            if (trimmed.startswith("[") or trimmed.startswith("(")) and is_num:
                m = RANGE_PATTERN.match(trimmed)
                if m:
                    left_bracket, min_str, max_str, right_bracket = m.groups()
                    try:
                        min_val, max_val = float(min_str), float(max_str)
                        min_ok = val_num >= min_val if left_bracket == "[" else val_num > min_val
                        max_ok = val_num <= max_val if right_bracket == "]" else val_num < max_val
                        return min_ok and max_ok
                    except ValueError:
                        return False

            if "," in trimmed:
                parts = [p.strip().strip("'\"") for p in trimmed.split(",")]
                return str(val) in parts

            clean = trimmed.strip("'\"")
            return str(val) == clean

        if isinstance(cell, (int, float)) and not isinstance(cell, bool):
            if isinstance(val, (int, float)) and not isinstance(val, bool):
                return float(cell) == float(val)
            return False

        if isinstance(cell, bool):
            return isinstance(val, bool) and cell == val

        if isinstance(cell, dict):
            ok, res = eval_node(cell, {"cell": val, "value": val, "input": {}}, None)
            return ok and _truthy(res)

        return False

    def _parse_decision_rules(self, table_def: Dict[str, Any], inputs: list, outputs: list) -> list:
        raw_rules = table_def.get("rules")
        if isinstance(raw_rules, list) and len(raw_rules) > 0:
            return raw_rules

        rows = table_def.get("rows")
        if not isinstance(rows, list):
            return []

        rules = []
        for i, row in enumerate(rows):
            if not isinstance(row, dict):
                continue
            r_inputs = [row.get(col.get("name"), "-") for col in inputs]
            r_outputs = {out.get("name"): row.get(out.get("name")) for out in outputs if out.get("name") in row}
            rules.append({
                "id": f"row-{i+1}",
                "inputs": r_inputs,
                "outputs": r_outputs,
            })
        return rules

    def _resolve_decision_outputs(self, rule_outputs: Dict[str, Any], columns: list, input_data: Dict[str, Any]) -> Dict[str, Any]:
        resolved: Dict[str, Any] = {}
        for col in columns:
            name = col.get("name")
            val = rule_outputs.get(name)
            col_type = str(col.get("type", "")).lower()

            if isinstance(val, str):
                trimmed = val.strip()
                if (trimmed.startswith("'") and trimmed.endswith("'")) or (trimmed.startswith('"') and trimmed.endswith('"')):
                    resolved[name] = trimmed[1:-1]
                elif (col_type.startswith("int") or col_type.startswith("number") or col_type.startswith("decimal")) and DECIMAL_WIRE.match(trimmed):
                    try:
                        resolved[name] = float(trimmed) if "." in trimmed else int(trimmed)
                    except ValueError:
                        resolved[name] = trimmed
                elif col_type.startswith("bool"):
                    resolved[name] = trimmed.lower() == "true"
                else:
                    resolved[name] = trimmed
            else:
                resolved[name] = val

        for k, v in rule_outputs.items():
            if k not in resolved:
                resolved[k] = v
        return resolved

    def compute(self, entity_name: str, record: Dict[str, Any]) -> Dict[str, Any]:
        """Materializes computed fields and default values on a record."""
        record = self.decode_record(entity_name, record) or {}
        entity = self.entities.get(entity_name, {})
        fields = entity.get("fields", {})
        result = dict(record)

        for field_name, raw_def in fields.items():
            field_def = raw_def if isinstance(raw_def, dict) else {}

            # Set default if missing
            if field_name not in result and "default" in field_def and field_def["default"] is not None:
                result[field_name] = field_def["default"]

            # Compute
            compute_expr = field_def.get("compute") if isinstance(field_def, dict) else None
            if compute_expr:
                if isinstance(compute_expr, str) and "(" in compute_expr and compute_expr.endswith(")"):
                    open_idx = compute_expr.index("(")
                    func_name = compute_expr[:open_idx].strip()
                    args_str = compute_expr[open_idx + 1 : -1].strip()
                    arg_names = [p.strip() for p in args_str.split(",") if p.strip()] if args_str else []
                    input_map = {arg_name: result.get(arg_name) for arg_name in arg_names}
                    res = self.evaluate_decision(func_name, input_map)
                    if res.get("matched"):
                        out_val = res.get("outputs")
                        if isinstance(out_val, dict) and len(out_val) == 1:
                            result[field_name] = next(iter(out_val.values()))
                        else:
                            result[field_name] = out_val

                elif isinstance(compute_expr, dict):
                    if compute_expr.get("type") == "call" and compute_expr.get("func") == "sum":
                        args = compute_expr.get("args", [])
                        if len(args) >= 1 and args[0].get("type") == "ref":
                            collection_key = args[0].get("name")
                            lines = result.get(collection_key, [])
                            if isinstance(lines, list):
                                total = 0.0
                                for item in lines:
                                    if isinstance(item, dict):
                                        qty = float(item.get("qty", 0))
                                        price = float(item.get("unitPrice", 0))
                                        total += qty * price
                                result[field_name] = total
                    elif compute_expr.get("type") == "call":
                        func_name = compute_expr.get("func")
                        if func_name:
                            input_map = {}
                            for i, arg in enumerate(compute_expr.get("args", [])):
                                if isinstance(arg, dict) and arg.get("type") == "ref":
                                    ref_name = arg.get("name")
                                    input_map[ref_name] = result.get(ref_name)
                                else:
                                    input_map[f"arg{i}"] = arg
                            res = self.evaluate_decision(func_name, input_map)
                            if res.get("matched"):
                                result[field_name] = res.get("outputs")

        return result

    def validate(self, entity_name: str, record: Dict[str, Any]) -> ValidationResult:
        """Validates fields, requiredness, types, and enum values."""
        entity = self.entities.get(entity_name)
        if not entity:
            return ValidationResult(
                valid=False,
                errors=[ValidationErrorItem(message=f"Unknown entity '{entity_name}'", code="UNKNOWN_ENTITY")]
            )

        record = self.decode_record(entity_name, record) or {}
        errors: List[ValidationErrorItem] = []
        fields = entity.get("fields", {})

        for field_name, raw_def in fields.items():
            field_def = raw_def if isinstance(raw_def, dict) else {}
            val = record.get(field_name)

            # Required check
            if field_def.get("required") and (val is None or val == ""):
                errors.append(ValidationErrorItem(
                    field=field_name,
                    message=f"Field '{field_name}' is required",
                    code="REQUIRED_FIELD"
                ))
                continue

            # Decimal wire validation check
            tname = _field_type_name(raw_def)
            if tname == "decimal" and val is not None:
                if not isinstance(val, (int, float)) or isinstance(val, bool):
                    errors.append(ValidationErrorItem(
                        field=field_name,
                        message=f"Field '{field_name}' must be a decimal number, such as \"12.50\"",
                        code="INVALID_DECIMAL",
                    ))
                    continue

            if val is not None:
                ftype = field_def.get("type")
                if ftype == "enum" and "values" in field_def:
                    if val not in field_def["values"]:
                        errors.append(ValidationErrorItem(
                            field=field_name,
                            message=f"Value '{val}' not in allowed enum values {field_def['values']}",
                            code="INVALID_ENUM"
                        ))

        return ValidationResult(valid=len(errors) == 0, errors=errors)

    def transition(
        self,
        entity_name: str,
        record: Dict[str, Any],
        transition_name: str,
        actor: Optional[Dict[str, Any]] = None
    ) -> ExecutionResult:
        """Executes a workflow state transition deterministically."""
        entity = self.entities.get(entity_name)
        if not entity:
            return ExecutionResult(ok=False, error="UNKNOWN_ENTITY")

        record = self.decode_record(entity_name, record) or {}

        workflow = entity.get("workflow")
        if not workflow:
            return ExecutionResult(ok=False, error="NO_WORKFLOW")

        transitions = workflow.get("transitions", {})
        transition_def = transitions.get(transition_name)
        if not transition_def:
            return ExecutionResult(ok=False, error="UNKNOWN_TRANSITION")

        # Roles check
        allowed_roles = transition_def.get("roles", [])
        if allowed_roles:
            actor_roles = (actor or {}).get("roles", [])
            if not any(r in actor_roles for r in allowed_roles):
                return ExecutionResult(
                    ok=False,
                    error="PERMISSION_DENIED",
                    message="Actor does not possess required role for this transition"
                )

        # State check
        status_field = workflow.get("field", "status")
        current_state = record.get(status_field)
        allowed_from = transition_def.get("from")
        if not isinstance(allowed_from, list):
            allowed_from = [allowed_from]

        if current_state not in allowed_from:
            return ExecutionResult(
                ok=False,
                error="INVALID_STATE_TRANSITION",
                message=f"Cannot transition '{transition_name}' from state '{current_state}'"
            )

        # A guard this subset cannot evaluate refuses the transition. One it can evaluate
        # must be true; false is GUARD_FAILED, not a skipped check (ADR-0008).
        when = transition_def.get("when")
        if when is not None:
            allowed, code = guard_allows(when, record)
            if not allowed:
                message = f"Transition '{transition_name}' guard evaluated to false"
                if code == "GUARD_UNSUPPORTED":
                    message = (
                        f"Transition '{transition_name}' has a guard this engine cannot evaluate yet; "
                        "run it through the reference engine"
                    )
                return ExecutionResult(ok=False, error=code, message=message)

        # Apply state transition
        next_record = self.compute(entity_name, dict(record))
        target_state = transition_def.get("to")
        next_record[status_field] = target_state

        events: List[Dict[str, Any]] = []
        side_effects = transition_def.get("then", [])
        if isinstance(side_effects, list):
            for effect in side_effects:
                if isinstance(effect, dict):
                    if "emit" in effect:
                        events.append({"name": effect["emit"], "data": effect.get("data")})
                    if "set" in effect and isinstance(effect["set"], dict):
                        for k, v in effect["set"].items():
                            if v == "now()":
                                next_record[k] = datetime.datetime.now(datetime.timezone.utc).isoformat()
                            else:
                                next_record[k] = v

        final_record = self.compute(entity_name, next_record)
        return ExecutionResult(ok=True, record=final_record, events=events)

