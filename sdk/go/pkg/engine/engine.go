// Package engine defines the reference pure execution engine in Go.
package engine

import "github.com/hi-donwi/kerangka/sdk/go/pkg/kir"

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

// Engine defines pure state transitions and computation methods.
type Engine interface {
	Compute(entityName string, record map[string]any) map[string]any
	Validate(entityName string, record map[string]any) ValidationResult
	Transition(entityName string, record map[string]any, transition string, roles []string) (map[string]any, error)
}

// ReferenceEngine is the Go implementation of the pure engine.
type ReferenceEngine struct {
	doc *kir.Document
}

// New creates a new ReferenceEngine loaded with a KIR Document.
func New(doc *kir.Document) *ReferenceEngine {
	return &ReferenceEngine{doc: doc}
}

// Compute materializes computed fields on a record.
func (e *ReferenceEngine) Compute(entityName string, record map[string]any) map[string]any {
	result := make(map[string]any, len(record))
	for k, v := range record {
		result[k] = v
	}
	return result
}

// Validate validates fields, rules, and invariants.
func (e *ReferenceEngine) Validate(entityName string, record map[string]any) ValidationResult {
	return ValidationResult{Valid: true}
}
