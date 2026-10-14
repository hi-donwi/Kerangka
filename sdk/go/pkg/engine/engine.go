// Package engine defines the reference pure execution engine in Go.
package engine

import (
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/hi-donwi/kerangka/sdk/go/pkg/kir"
)

// ValidationResult represents rule and invariant validation outcomes.
type ValidationResult struct {
	Valid  bool
	Errors []ValidationError
}

// ValidationError holds constraint failure details.
type ValidationError struct {
	Field   string
	Message string
	Code    string
}

// ExecutionResult holds state transition output.
type ExecutionResult struct {
	OK      bool
	Record  map[string]any
	Error   string
	Message string
	Events  []map[string]any
}

// Decision is the outcome of an authorization check.
type Decision struct {
	Allowed bool
	// Code is PERMISSION_DENIED, or UNSUPPORTED when deciding needs something this engine
	// cannot do yet (evaluating a condition); the caller must refuse either way.
	Code   string
	Reason string
}

// ReferenceEngine is the Go implementation of the pure engine.
type ReferenceEngine struct {
	doc *kir.Document
}

// New creates a new ReferenceEngine loaded with a KIR Document.
func New(doc *kir.Document) *ReferenceEngine {
	return &ReferenceEngine{doc: doc}
}

// DecodeRecord decodes decimal wire strings to float64 recursively by declared field types.
func (e *ReferenceEngine) DecodeRecord(entityName string, record map[string]any) map[string]any {
	if record == nil {
		return nil
	}
	entity, ok := e.doc.Entities[entityName]
	if !ok {
		return record
	}
	return e.decodeFields(entity.Fields, record, 0)
}

func (e *ReferenceEngine) decodeFields(defs map[string]any, record map[string]any, depth int) map[string]any {
	if depth > 16 || record == nil {
		return record
	}
	out := make(map[string]any, len(record))
	for k, v := range record {
		out[k] = v
	}

	for name, rawDef := range defs {
		val, exists := out[name]
		if !exists || val == nil {
			continue
		}
		out[name] = e.decodeValue(rawDef, val, depth+1)
	}
	return out
}

func fieldTypeName(def any) string {
	switch d := def.(type) {
	case string:
		fields := strings.Fields(d)
		if len(fields) > 0 {
			clean := strings.TrimRight(fields[0], "!")
			if idx := strings.Index(clean, "("); idx != -1 {
				clean = clean[:idx]
			}
			return clean
		}
	case map[string]any:
		if t, ok := d["type"].(string); ok {
			return t
		}
	}
	return ""
}

func (e *ReferenceEngine) decodeValue(def any, val any, depth int) any {
	typeName := strings.ToLower(fieldTypeName(def))
	if typeName == "decimal" {
		if s, ok := val.(string); ok {
			trimmed := strings.TrimSpace(s)
			if decimalWireRegex.MatchString(trimmed) {
				if num, err := strconv.ParseFloat(trimmed, 64); err == nil {
					return num
				}
			}
		}
		return val
	}
	if typeName == "list" {
		if list, ok := val.([]any); ok {
			var elemDef any
			if m, ok := def.(map[string]any); ok {
				elemDef = m["element"]
			}
			if elemDef != nil {
				var decodedList []any
				for _, item := range list {
					decodedList = append(decodedList, e.decodeValue(elemDef, item, depth+1))
				}
				return decodedList
			}
		}
		return val
	}

	target := typeName
	if m, ok := def.(map[string]any); ok {
		if targetStr, ok := m["target"].(string); ok && targetStr != "" {
			target = targetStr
		}
	}

	if target != "" {
		if valMap, ok := val.(map[string]any); ok {
			if targetEntity, exists := e.doc.Entities[target]; exists {
				if targetEntity.Embedded {
					return e.decodeFields(targetEntity.Fields, valMap, depth)
				}
			}
		}
	}

	return val
}

// Compute materializes default values and computed fields on a record.
func (e *ReferenceEngine) Compute(entityName string, record map[string]any) map[string]any {
	record = e.DecodeRecord(entityName, record)
	result := make(map[string]any, len(record))
	for k, v := range record {
		result[k] = v
	}

	entity, ok := e.doc.Entities[entityName]
	if !ok {
		return result
	}

	for fieldName, rawDef := range entity.Fields {
		var fieldDef map[string]any
		switch d := rawDef.(type) {
		case map[string]any:
			fieldDef = d
		}

		if fieldDef == nil {
			continue
		}

		// Apply default value if missing
		if _, exists := result[fieldName]; !exists {
			if defVal, hasDef := fieldDef["default"]; hasDef && defVal != nil {
				result[fieldName] = defVal
			}
		}

		// Check compute
		if computeVal, hasCompute := fieldDef["compute"]; hasCompute && computeVal != nil {
			switch c := computeVal.(type) {
			case string:
				// E.g. "approverRouting(days)" or "grade(score)"
				if openIdx := strings.Index(c, "("); openIdx != -1 && strings.HasSuffix(c, ")") {
					funcName := strings.TrimSpace(c[:openIdx])
					argsStr := c[openIdx+1 : len(c)-1]
					var argNames []string
					if strings.TrimSpace(argsStr) != "" {
						for _, p := range strings.Split(argsStr, ",") {
							argNames = append(argNames, strings.TrimSpace(p))
						}
					}
					inputMap := make(map[string]any)
					for _, argName := range argNames {
						inputMap[argName] = result[argName]
					}
					res := e.Decide(funcName, inputMap)
					if res.Matched {
						if m, ok := res.Outputs.(map[string]any); ok {
							if len(m) == 1 {
								for _, v := range m {
									result[fieldName] = v
									break
								}
							} else {
								result[fieldName] = m
							}
						} else {
							result[fieldName] = res.Outputs
						}
					}
				}
			case map[string]any:
				if c["type"] == "call" && c["func"] == "sum" {
					if args, ok := c["args"].([]any); ok && len(args) >= 1 {
						if refArg, ok := args[0].(map[string]any); ok && refArg["type"] == "ref" {
							collectionKey, _ := refArg["name"].(string)
							if lines, ok := result[collectionKey].([]any); ok {
								var total float64
								for _, line := range lines {
									if lineMap, ok := line.(map[string]any); ok {
										qty, _ := toFloat(lineMap["qty"])
										price, _ := toFloat(lineMap["unitPrice"])
										total += qty * price
									}
								}
								result[fieldName] = total
							}
						}
					}
				} else if c["type"] == "call" {
					if funcName, ok := c["func"].(string); ok {
						inputMap := make(map[string]any)
						if args, ok := c["args"].([]any); ok {
							for i, arg := range args {
								if ref, ok := arg.(map[string]any); ok && ref["type"] == "ref" {
									refName, _ := ref["name"].(string)
									inputMap[refName] = result[refName]
								} else {
									inputMap[fmt.Sprintf("arg%d", i)] = arg
								}
							}
						}
						res := e.Decide(funcName, inputMap)
						if res.Matched {
							result[fieldName] = res.Outputs
						}
					}
				}
			}
		}
	}

	return result
}

// Validate validates fields, rules, and invariants.
func (e *ReferenceEngine) Validate(entityName string, record map[string]any) ValidationResult {
	entity, ok := e.doc.Entities[entityName]
	if !ok {
		return ValidationResult{
			Valid: false,
			Errors: []ValidationError{
				{Message: fmt.Sprintf("unknown entity '%s'", entityName), Code: "UNKNOWN_ENTITY"},
			},
		}
	}

	record = e.DecodeRecord(entityName, record)
	var errs []ValidationError
	for fieldName, rawDef := range entity.Fields {
		var fieldDef map[string]any
		switch d := rawDef.(type) {
		case map[string]any:
			fieldDef = d
		}

		val := record[fieldName]
		if fieldDef != nil {
			req, _ := fieldDef["required"].(bool)
			if req && (val == nil || val == "") {
				errs = append(errs, ValidationError{
					Field:   fieldName,
					Message: fmt.Sprintf("field '%s' is required", fieldName),
					Code:    "REQUIRED_FIELD",
				})
				continue
			}
		}

		tName := strings.ToLower(fieldTypeName(rawDef))
		if tName == "decimal" && val != nil {
			if _, ok := toFloat(val); !ok {
				errs = append(errs, ValidationError{
					Field:   fieldName,
					Message: fmt.Sprintf("Field '%s' must be a decimal number, such as \"12.50\"", fieldName),
					Code:    "INVALID_DECIMAL",
				})
				continue
			}
		}

		if val != nil && fieldDef != nil {
			if fieldDef["type"] == "enum" {
				if values, ok := fieldDef["values"].([]any); ok {
					found := false
					for _, v := range values {
						if v == val {
							found = true
							break
						}
					}
					if !found {
						errs = append(errs, ValidationError{
							Field:   fieldName,
							Message: fmt.Sprintf("value '%v' not in allowed enum values", val),
							Code:    "INVALID_ENUM",
						})
					}
				}
			}
		}
	}

	return ValidationResult{Valid: len(errs) == 0, Errors: errs}
}


// ActorContext holds identity and tenant context for authorization decisions.
type ActorContext struct {
	ID       string         `json:"id,omitempty"`
	TenantID string         `json:"tenantId,omitempty"`
	Roles    []string       `json:"roles,omitempty"`
	Extra    map[string]any `json:"extra,omitempty"`
}

// Resolve resolves an actor attribute such as id, tenantId, roles, or a dotted extra field.
func (a *ActorContext) Resolve(path string) any {
	if a == nil {
		return nil
	}
	switch path {
	case "id":
		return a.ID
	case "tenantId":
		return a.TenantID
	case "roles":
		return a.Roles
	}
	if a.Extra != nil {
		return resolveBind(path, a.Extra)
	}
	return nil
}

// ReadScope is the outcome of a read authorization check (ADR-0040).
type ReadScope struct {
	Allowed bool   `json:"allowed"`
	Code    string `json:"code,omitempty"`
	Reason  string `json:"reason,omitempty"`
	Where   any    `json:"where,omitempty"`
}

// CanOperate decides whether an actor may perform a CRUD operation on an entity (ADR-0044).
// An operation the model does not mention is open. A role list grants the roles it names,
// and an empty list grants no one. A role map grants roles mapped to true; a role mapped to
// a condition is evaluated against record and actor. If deciding requires a record and record
// is nil, PERMISSION_NEEDS_RECORD is returned.
func (e *ReferenceEngine) CanOperate(
	entityName, operation string,
	actor *ActorContext,
	record map[string]any,
) Decision {
	entity, ok := e.doc.Entities[entityName]
	if !ok {
		return Decision{Code: "UNKNOWN_ENTITY", Reason: fmt.Sprintf("unknown entity '%s'", entityName)}
	}
	if entity.Permissions == nil {
		return Decision{Allowed: true}
	}
	declared, mentioned := entity.Permissions[operation]
	if !mentioned {
		return Decision{Allowed: true}
	}

	var roles []string
	if actor != nil {
		roles = actor.Roles
	}
	has := func(role string) bool {
		for _, r := range roles {
			if r == role {
				return true
			}
		}
		return false
	}

	switch grant := declared.(type) {
	case []any:
		for _, r := range grant {
			if role, ok := r.(string); ok && has(role) {
				return Decision{Allowed: true}
			}
		}
		if len(grant) == 0 {
			return Decision{Code: "PERMISSION_DENIED", Reason: fmt.Sprintf("'%s' on '%s' is granted to no role", operation, entityName)}
		}
		return Decision{Code: "PERMISSION_DENIED", Reason: fmt.Sprintf("'%s' on '%s' requires one of %v", operation, entityName, grant)}

	case map[string]any:
		var conditions []any
		for role, value := range grant {
			if !has(role) {
				continue
			}
			if value == true {
				return Decision{Allowed: true}
			}
			if value == false {
				continue
			}
			conditions = append(conditions, value)
		}

		if len(conditions) > 0 {
			if record == nil {
				return Decision{
					Code:   "PERMISSION_NEEDS_RECORD",
					Reason: fmt.Sprintf("'%s' on '%s' is granted to this actor only under a condition on the record", operation, entityName),
				}
			}
			for _, cond := range conditions {
				outcome := evalCondition(cond, record, actor)
				if outcome.Supported && truthy(outcome.Value) {
					return Decision{Allowed: true}
				}
			}
			return Decision{
				Code:   "PERMISSION_DENIED",
				Reason: fmt.Sprintf("'%s' on '%s' condition evaluated to false or unsupported", operation, entityName),
			}
		}

		return Decision{Code: "PERMISSION_DENIED", Reason: fmt.Sprintf("'%s' on '%s' is not granted to this actor", operation, entityName)}

	default:
		return Decision{Code: "PERMISSION_DENIED", Reason: fmt.Sprintf("'%s' on '%s' has a permission this engine cannot read", operation, entityName)}
	}
}

// Authorize decides whether actor roles may perform a CRUD operation on an entity (ADR-0044).
// Retained for backward compatibility. If a condition requires a record, it returns UNSUPPORTED.
func (e *ReferenceEngine) Authorize(entityName, operation string, roles []string) Decision {
	dec := e.CanOperate(entityName, operation, &ActorContext{Roles: roles}, nil)
	if dec.Code == "PERMISSION_NEEDS_RECORD" {
		return Decision{
			Allowed: false,
			Code:    "UNSUPPORTED",
			Reason:  dec.Reason,
		}
	}
	return dec
}

// AuthorizeRead determines the read predicate for an entity or refuses if unauthorized (ADR-0040).
func (e *ReferenceEngine) AuthorizeRead(entityName string, actor *ActorContext) ReadScope {
	entity, ok := e.doc.Entities[entityName]
	if !ok {
		return ReadScope{
			Allowed: false,
			Code:    "UNKNOWN_ENTITY",
			Reason:  fmt.Sprintf("Entity '%s' is not in the model, so nothing is known about who may read it", entityName),
		}
	}

	var conditions []any

	// 1. Tenant scope
	isTenantScoped := false
	if entity.Fields != nil {
		if _, hasTenant := entity.Fields["tenantId"]; hasTenant {
			isTenantScoped = true
		}
	}
	if e.doc.Multitenancy != nil {
		isTenantScoped = true
	}

	if isTenantScoped {
		if actor == nil || actor.TenantID == "" {
			return ReadScope{
				Allowed: false,
				Code:    "PERMISSION_DENIED",
				Reason:  fmt.Sprintf("'%s' is tenant-scoped and the request established no tenant. A tenant-scoped read with no caller is refused, not answered with every tenant's rows.", entityName),
			}
		}
		conditions = append(conditions, []any{"==", []any{"get", "tenantId"}, actor.TenantID})
	}

	// 2. Soft delete
	isSoftDelete := false
	for _, tr := range entity.Traits {
		if tr == "std:softDelete" {
			isSoftDelete = true
			break
		}
	}
	if entity.Fields != nil {
		if _, hasDel := entity.Fields["deleted"]; hasDel {
			isSoftDelete = true
		} else if _, hasDelAt := entity.Fields["deletedAt"]; hasDelAt {
			isSoftDelete = true
		}
	}

	if isSoftDelete && entity.Fields != nil {
		if _, hasDel := entity.Fields["deleted"]; hasDel {
			conditions = append(conditions, []any{"==", []any{"get", "deleted"}, false})
		} else if _, hasDelAt := entity.Fields["deletedAt"]; hasDelAt {
			conditions = append(conditions, []any{"is_null", []any{"get", "deletedAt"}})
		}
	}

	// 3. The entity's declared readFilter
	declared := entity.ReadFilter
	if declaredStr, ok := declared.(string); ok && declaredStr != "" {
		return ReadScope{
			Allowed: false,
			Code:    "READ_FILTER_NOT_COMPILED",
			Reason:  fmt.Sprintf("The readFilter on '%s' is still a string, so it was never lowered and would be ignored. This is a compiler bypass, not a model error.", entityName),
		}
	}
	if declaredArr, ok := declared.([]any); ok && len(declaredArr) > 0 {
		conditions = append(conditions, declaredArr)
	}

	if len(conditions) == 0 {
		return ReadScope{Allowed: true, Where: nil}
	}
	if len(conditions) == 1 {
		return ReadScope{Allowed: true, Where: conditions[0]}
	}
	res := make([]any, 0, len(conditions)+1)
	res = append(res, "and")
	res = append(res, conditions...)
	return ReadScope{Allowed: true, Where: res}
}

// ReadFilter returns the read predicate for an entity, or nil when unrestricted or denied.
func (e *ReferenceEngine) ReadFilter(entityName string, actor *ActorContext) any {
	scope := e.AuthorizeRead(entityName, actor)
	if !scope.Allowed {
		return nil
	}
	return scope.Where
}

// EvalFilter evaluates a predicate tuple against a record and actor context in memory.
func (e *ReferenceEngine) EvalFilter(predicate any, record map[string]any, actor *ActorContext) bool {
	if predicate == nil {
		return true
	}
	outcome := evalNode(predicate, record, actor)
	return outcome.Supported && truthy(outcome.Value)
}

// HasReadFilter reports whether reads of the entity are filtered per record (ADR-0040), which
// this engine cannot apply yet, so a server must refuse the read instead of skipping the filter.
func (e *ReferenceEngine) HasReadFilter(entityName string) bool {
	entity, ok := e.doc.Entities[entityName]
	return ok && entity.ReadFilter != nil
}

// Transition executes a state transition deterministically.
func (e *ReferenceEngine) Transition(
	entityName string,
	record map[string]any,
	transitionName string,
	actorRoles []string,
) (ExecutionResult, error) {
	entity, ok := e.doc.Entities[entityName]
	if !ok {
		return ExecutionResult{OK: false, Error: "UNKNOWN_ENTITY"}, errors.New("unknown entity")
	}

	record = e.DecodeRecord(entityName, record)

	wf := entity.Workflow
	if wf == nil {

		return ExecutionResult{OK: false, Error: "NO_WORKFLOW"}, errors.New("no workflow defined")
	}

	transitions, _ := wf["transitions"].(map[string]any)
	rawTr, ok := transitions[transitionName]
	if !ok {
		return ExecutionResult{OK: false, Error: "UNKNOWN_TRANSITION"}, errors.New("unknown transition")
	}
	tr, _ := rawTr.(map[string]any)

	// Roles check
	if roles, ok := tr["roles"].([]any); ok && len(roles) > 0 {
		hasRole := false
		for _, r := range roles {
			rStr, _ := r.(string)
			for _, ar := range actorRoles {
				if ar == rStr {
					hasRole = true
					break
				}
			}
		}
		if !hasRole {
			return ExecutionResult{
				OK:      false,
				Error:   "PERMISSION_DENIED",
				Message: "actor does not possess required role",
			}, nil
		}
	}

	statusField, _ := wf["field"].(string)
	if statusField == "" {
		statusField = "status"
	}
	currentStatus, _ := record[statusField].(string)

	// State check
	allowedFrom := []string{}
	if fromStr, ok := tr["from"].(string); ok {
		allowedFrom = append(allowedFrom, fromStr)
	} else if fromArr, ok := tr["from"].([]any); ok {
		for _, f := range fromArr {
			if fStr, ok := f.(string); ok {
				allowedFrom = append(allowedFrom, fStr)
			}
		}
	}

	fromMatch := false
	for _, f := range allowedFrom {
		if f == currentStatus {
			fromMatch = true
			break
		}
	}
	if !fromMatch {
		return ExecutionResult{
			OK:      false,
			Error:   "INVALID_STATE_TRANSITION",
			Message: fmt.Sprintf("cannot transition '%s' from state '%s'", transitionName, currentStatus),
		}, nil
	}

	// A guard this subset cannot evaluate refuses the transition rather than skipping it.
	// A guard it can evaluate must be true; false is GUARD_FAILED, not a skipped check (ADR-0008).
	if when, ok := tr["when"]; ok && when != nil {
		allowed, code := guardAllows(when, record)
		if !allowed {
			message := fmt.Sprintf("transition '%s' guard evaluated to false", transitionName)
			if code == "GUARD_UNSUPPORTED" {
				message = fmt.Sprintf("transition '%s' has a guard this engine cannot evaluate yet; run it through the reference engine", transitionName)
			}
			return ExecutionResult{OK: false, Error: code, Message: message}, nil
		}
	}

	nextRecord := e.Compute(entityName, record)
	toStatus, _ := tr["to"].(string)
	nextRecord[statusField] = toStatus

	// Side effects
	var events []map[string]any
	if effects, ok := tr["then"].([]any); ok {
		for _, ef := range effects {
			if efMap, ok := ef.(map[string]any); ok {
				if emit, ok := efMap["emit"].(string); ok {
					events = append(events, map[string]any{
						"name": emit,
						"data": efMap["data"],
					})
				}
				if setMap, ok := efMap["set"].(map[string]any); ok {
					for k, v := range setMap {
						if v == "now()" {
							nextRecord[k] = time.Now().UTC().Format(time.RFC3339)
						} else {
							nextRecord[k] = v
						}
					}
				}
			}
		}
	}

	finalRecord := e.Compute(entityName, nextRecord)
	return ExecutionResult{
		OK:     true,
		Record: finalRecord,
		Events: events,
	}, nil
}

func toFloat(v any) (float64, bool) {
	switch n := v.(type) {
	case float64:
		return n, true
	case int:
		return float64(n), true
	case int64:
		return float64(n), true
	default:
		return 0, false
	}
}
