"""
Kerangka Reference Engine in Python.
Specification Version: 0.1
Status: Draft
License: Apache-2.0
"""

from typing import Dict, Any, List, Optional
from dataclasses import dataclass, field
import datetime

from .eval import guard_allows, eval_condition, eval_node, _truthy


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

    def compute(self, entity_name: str, record: Dict[str, Any]) -> Dict[str, Any]:
        """Materializes computed fields and default values on a record."""
        entity = self.entities.get(entity_name, {})
        fields = entity.get("fields", {})
        result = dict(record)

        for field_name, field_def in fields.items():
            if isinstance(field_def, dict):
                # Set default if missing
                if field_name not in result and "default" in field_def and field_def["default"] is not None:
                    result[field_name] = field_def["default"]

                # Aggregate compute simulation (e.g. sum(lines, qty * unitPrice))
                compute_expr = field_def.get("compute")
                if compute_expr and isinstance(compute_expr, dict):
                    if compute_expr.get("type") == "call" and compute_expr.get("func") == "sum":
                        args = compute_expr.get("args", [])
                        if len(args) >= 2 and args[0].get("type") == "ref":
                            collection_key = args[0].get("name")
                            lines = result.get(collection_key, [])
                            if isinstance(lines, list):
                                total = sum(
                                    (item.get("qty", 0) * item.get("unitPrice", 0))
                                    for item in lines
                                    if isinstance(item, dict)
                                )
                                result[field_name] = total

        return result

    def validate(self, entity_name: str, record: Dict[str, Any]) -> ValidationResult:
        """Validates fields, requiredness, types, and enum values."""
        entity = self.entities.get(entity_name)
        if not entity:
            return ValidationResult(
                valid=False,
                errors=[ValidationErrorItem(message=f"Unknown entity '{entity_name}'", code="UNKNOWN_ENTITY")]
            )

        errors: List[ValidationErrorItem] = []
        fields = entity.get("fields", {})

        for field_name, field_def in fields.items():
            val = record.get(field_name)

            # Required check
            if field_def.get("required") and (val is None or val == ""):
                errors.append(ValidationErrorItem(
                    field=field_name,
                    message=f"Field '{field_name}' is required",
                    code="REQUIRED_FIELD"
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
