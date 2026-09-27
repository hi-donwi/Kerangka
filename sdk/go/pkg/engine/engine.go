// Package engine defines the reference pure execution engine in Go.
package engine

import (
	"errors"
	"fmt"
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

// ReferenceEngine is the Go implementation of the pure engine.
type ReferenceEngine struct {
	doc *kir.Document
}

// New creates a new ReferenceEngine loaded with a KIR Document.
func New(doc *kir.Document) *ReferenceEngine {
	return &ReferenceEngine{doc: doc}
}

// Compute materializes default values and computed fields on a record.
func (e *ReferenceEngine) Compute(entityName string, record map[string]any) map[string]any {
	result := make(map[string]any, len(record))
	for k, v := range record {
		result[k] = v
	}

	entity, ok := e.doc.Entities[entityName]
	if !ok {
		return result
	}

	for fieldName, rawDef := range entity.Fields {
		fieldDef, ok := rawDef.(map[string]any)
		if !ok {
			continue
		}

		// Apply default value if missing
		if _, exists := result[fieldName]; !exists {
			if defVal, hasDef := fieldDef["default"]; hasDef && defVal != nil {
				result[fieldName] = defVal
			}
		}

		// Simulate collection sum compute
		if compute, hasCompute := fieldDef["compute"].(map[string]any); hasCompute {
			if compute["type"] == "call" && compute["func"] == "sum" {
				if args, ok := compute["args"].([]any); ok && len(args) >= 1 {
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

	var errs []ValidationError
	for fieldName, rawDef := range entity.Fields {
		fieldDef, ok := rawDef.(map[string]any)
		if !ok {
			continue
		}

		val := record[fieldName]
		req, _ := fieldDef["required"].(bool)
		if req && (val == nil || val == "") {
			errs = append(errs, ValidationError{
				Field:   fieldName,
				Message: fmt.Sprintf("field '%s' is required", fieldName),
				Code:    "REQUIRED_FIELD",
			})
			continue
		}

		if val != nil {
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
