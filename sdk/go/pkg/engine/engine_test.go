package engine

import (
	"testing"

	"github.com/hi-donwi/kerangka/sdk/go/pkg/kir"
)

func TestGoEngine(t *testing.T) {
	doc := &kir.Document{
		KIR: "0.1",
		App: "invoicing",
		Entities: map[string]kir.Entity{
			"Invoice": {
				Key: "number",
				Fields: map[string]any{
					"number":   map[string]any{"type": "string", "required": true},
					"customer": map[string]any{"type": "string", "required": true},
					"status": map[string]any{
						"type":    "enum",
						"values":  []any{"draft", "sent", "paid", "void"},
						"default": "draft",
					},
					"total": map[string]any{
						"type": "decimal",
						"compute": map[string]any{
							"type": "call",
							"func": "sum",
							"args": []any{
								map[string]any{"type": "ref", "name": "lines"},
							},
						},
					},
				},
				Workflow: map[string]any{
					"field": "status",
					"transitions": map[string]any{
						"send": map[string]any{
							"from":  "draft",
							"to":    "sent",
							"roles": []any{"billing"},
							"then": []any{
								map[string]any{"emit": "InvoiceSent"},
							},
						},
					},
				},
			},
		},
	}

	eng := New(doc)

	// Test 1: Compute
	record := map[string]any{
		"number":   "INV-100",
		"customer": "CUST-1",
		"lines": []any{
			map[string]any{"description": "Item 1", "qty": 2, "unitPrice": 45.0},
			map[string]any{"description": "Item 2", "qty": 1, "unitPrice": 10.0},
		},
	}
	computed := eng.Compute("Invoice", record)
	if computed["total"] != 100.0 {
		t.Fatalf("expected total 100.0, got %v", computed["total"])
	}
	if computed["status"] != "draft" {
		t.Fatalf("expected default status 'draft', got %v", computed["status"])
	}

	// Test 2: Validation
	valRes := eng.Validate("Invoice", map[string]any{
		"number":   "INV-100",
		"customer": "CUST-1",
		"status":   "draft",
	})
	if !valRes.Valid {
		t.Fatalf("expected valid record, got errors: %v", valRes.Errors)
	}

	invalidRes := eng.Validate("Invoice", map[string]any{
		"number":   "INV-100",
		"customer": "CUST-1",
		"status":   "invalid_state",
	})
	if invalidRes.Valid {
		t.Fatalf("expected invalid record on enum mismatch")
	}

	// Test 3: Transitions
	denied, _ := eng.Transition("Invoice", computed, "send", []string{"viewer"})
	if denied.OK {
		t.Fatalf("expected permission denied for viewer role")
	}

	allowed, err := eng.Transition("Invoice", computed, "send", []string{"billing"})
	if err != nil || !allowed.OK {
		t.Fatalf("expected transition to succeed for billing role, got err: %v", err)
	}
	if allowed.Record["status"] != "sent" {
		t.Fatalf("expected status 'sent', got %v", allowed.Record["status"])
	}
	if len(allowed.Events) != 1 || allowed.Events[0]["name"] != "InvoiceSent" {
		t.Fatalf("expected InvoiceSent event to be emitted")
	}
}
