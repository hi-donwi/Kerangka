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

func guardDoc(when any) *kir.Document {
	return &kir.Document{
		KIR: "0.1",
		App: "guards",
		Entities: map[string]kir.Entity{
			"Invoice": {
				Fields: map[string]any{"status": map[string]any{"type": "enum", "values": []any{"draft", "sent"}}},
				Workflow: map[string]any{
					"field": "status",
					"transitions": map[string]any{
						"send": map[string]any{"from": "draft", "to": "sent", "when": when},
					},
				},
			},
		},
	}
}

func TestAComparisonGuardIsEvaluated(t *testing.T) {
	eng := New(guardDoc(map[string]any{
		"$expr": "==",
		"args":  []any{map[string]any{"$bind": "status"}, map[string]any{"literal": "draft"}},
	}))
	ok, err := eng.Transition("Invoice", map[string]any{"status": "draft"}, "send", nil)
	if err != nil || !ok.OK || ok.Record["status"] != "sent" {
		t.Fatalf("true guard should allow the transition, got %+v err %v", ok, err)
	}

	denied, _ := eng.Transition("Invoice", map[string]any{"status": "sent"}, "send", nil)
	if denied.OK || denied.Error != "INVALID_STATE_TRANSITION" {
		t.Fatalf("wrong state should still be refused, got %+v", denied)
	}

	falseGuard := New(guardDoc(map[string]any{
		"$expr": "==",
		"args":  []any{map[string]any{"$bind": "status"}, map[string]any{"literal": "sent"}},
	}))
	failed, _ := falseGuard.Transition("Invoice", map[string]any{"status": "draft"}, "send", nil)
	if failed.OK || failed.Error != "GUARD_FAILED" {
		t.Fatalf("false guard should not run the transition, got %+v", failed)
	}

	both := New(guardDoc(map[string]any{
		"$expr": "&&",
		"args": []any{
			map[string]any{"$expr": "==", "args": []any{map[string]any{"$bind": "status"}, map[string]any{"literal": "draft"}}},
			map[string]any{"$expr": "!=", "args": []any{map[string]any{"$bind": "status"}, map[string]any{"literal": "sent"}}},
		},
	}))
	joined, _ := both.Transition("Invoice", map[string]any{"status": "draft"}, "send", nil)
	if !joined.OK {
		t.Fatalf("&& guard should allow the transition, got %+v", joined)
	}

	unsupported := New(guardDoc(map[string]any{"$expr": "today", "args": []any{}}))
	refused, _ := unsupported.Transition("Invoice", map[string]any{"status": "draft"}, "send", nil)
	if refused.OK || refused.Error != "GUARD_UNSUPPORTED" {
		t.Fatalf("unsupported guard should refuse, got %+v", refused)
	}
}

func TestCanOperatePermissions(t *testing.T) {
	doc := &kir.Document{
		KIR: "0.1",
		App: "perms-test",
		Entities: map[string]kir.Entity{
			"Invoice": {
				Fields: map[string]any{
					"status":  map[string]any{"type": "enum", "values": []any{"draft", "sent"}},
					"ownerId": map[string]any{"type": "string"},
					"total":   map[string]any{"type": "decimal"},
				},
				Permissions: map[string]any{
					"read":   []any{"admin", "billing", "viewer"},
					"create": []any{"admin", "billing"},
					"update": map[string]any{
						"admin":   true,
						"billing": "status == 'draft'",
						"owner":   "ownerId == actor.id",
						"viewer":  false,
					},
					"delete": []any{},
				},
			},
			"PublicDoc": {
				Fields: map[string]any{"id": map[string]any{"type": "string"}},
			},
		},
	}
	eng := New(doc)

	admin := &ActorContext{ID: "u-admin", Roles: []string{"admin"}}
	billing := &ActorContext{ID: "u-billing", Roles: []string{"billing"}}
	viewer := &ActorContext{ID: "u-viewer", Roles: []string{"viewer"}}
	owner := &ActorContext{ID: "u-owner-1", Roles: []string{"owner"}}

	// Unlisted operation is open
	if dec := eng.CanOperate("Invoice", "archive", viewer, nil); !dec.Allowed {
		t.Fatalf("unlisted operation should be open, got %+v", dec)
	}

	// Empty list grants no one
	if dec := eng.CanOperate("Invoice", "delete", admin, nil); dec.Allowed || dec.Code != "PERMISSION_DENIED" {
		t.Fatalf("empty list should deny everyone, got %+v", dec)
	}

	// Unknown entity refused
	if dec := eng.CanOperate("Unknown", "read", admin, nil); dec.Allowed || dec.Code != "UNKNOWN_ENTITY" {
		t.Fatalf("unknown entity should be refused, got %+v", dec)
	}

	// Role mapped to true allows with or without record
	if dec := eng.CanOperate("Invoice", "update", admin, nil); !dec.Allowed {
		t.Fatalf("admin true grant should allow without record, got %+v", dec)
	}
	if dec := eng.CanOperate("Invoice", "update", admin, map[string]any{"status": "sent"}); !dec.Allowed {
		t.Fatalf("admin true grant should allow with record, got %+v", dec)
	}

	// Role mapped to false refused
	if dec := eng.CanOperate("Invoice", "update", viewer, map[string]any{"status": "draft"}); dec.Allowed || dec.Code != "PERMISSION_DENIED" {
		t.Fatalf("viewer false grant should be refused, got %+v", dec)
	}

	// Conditional grant without record returns PERMISSION_NEEDS_RECORD
	if dec := eng.CanOperate("Invoice", "update", billing, nil); dec.Allowed || dec.Code != "PERMISSION_NEEDS_RECORD" {
		t.Fatalf("conditional grant without record should return PERMISSION_NEEDS_RECORD, got %+v", dec)
	}

	// Conditional grant with matching record
	draftRecord := map[string]any{"status": "draft", "ownerId": "u-other"}
	if dec := eng.CanOperate("Invoice", "update", billing, draftRecord); !dec.Allowed {
		t.Fatalf("billing on draft should be allowed, got %+v", dec)
	}

	// Conditional grant with non-matching record
	sentRecord := map[string]any{"status": "sent", "ownerId": "u-owner-1"}
	if dec := eng.CanOperate("Invoice", "update", billing, sentRecord); dec.Allowed || dec.Code != "PERMISSION_DENIED" {
		t.Fatalf("billing on sent invoice should be denied, got %+v", dec)
	}

	// Actor context matching in condition (ownerId == actor.id)
	if dec := eng.CanOperate("Invoice", "update", owner, sentRecord); !dec.Allowed {
		t.Fatalf("owner should be allowed to update their own invoice, got %+v", dec)
	}
	otherOwnerRecord := map[string]any{"status": "sent", "ownerId": "u-other-owner"}
	if dec := eng.CanOperate("Invoice", "update", owner, otherOwnerRecord); dec.Allowed || dec.Code != "PERMISSION_DENIED" {
		t.Fatalf("owner should not be allowed to update another user's invoice, got %+v", dec)
	}
}

func TestAuthorizeReadAndEvalFilter(t *testing.T) {
	doc := &kir.Document{
		KIR: "0.1",
		App: "read-filter-test",
		Entities: map[string]kir.Entity{
			"Public": {
				Fields: map[string]any{"id": map[string]any{"type": "string"}},
			},
			"Scoped": {
				Fields: map[string]any{"tenantId": map[string]any{"type": "string"}},
			},
			"SoftDeleted": {
				Fields: map[string]any{"deleted": map[string]any{"type": "boolean"}},
			},
			"SoftDeletedAt": {
				Fields: map[string]any{"deletedAt": map[string]any{"type": "datetime"}},
			},
			"Doc": {
				Fields:     map[string]any{"tenantId": map[string]any{"type": "string"}},
				ReadFilter: []any{"==", []any{"get", "ownerId"}, []any{"actor", "id"}},
			},
			"BrokenDoc": {
				Fields:     map[string]any{"tenantId": map[string]any{"type": "string"}},
				ReadFilter: "status == 'draft'", // uncompiled string
			},
		},
	}
	eng := New(doc)

	adminWithTenant := &ActorContext{ID: "u-1", TenantID: "tenant-a", Roles: []string{"admin"}}
	adminNoTenant := &ActorContext{ID: "u-1", Roles: []string{"admin"}}

	// Public entity
	pubScope := eng.AuthorizeRead("Public", nil)
	if !pubScope.Allowed || pubScope.Where != nil {
		t.Fatalf("public entity should allow with where == nil, got %+v", pubScope)
	}

	// Unknown entity
	unkScope := eng.AuthorizeRead("Unknown", adminWithTenant)
	if unkScope.Allowed || unkScope.Code != "UNKNOWN_ENTITY" {
		t.Fatalf("unknown entity should be refused, got %+v", unkScope)
	}

	// Scoped entity without actor tenantId denied
	scopedNoTenant := eng.AuthorizeRead("Scoped", adminNoTenant)
	if scopedNoTenant.Allowed || scopedNoTenant.Code != "PERMISSION_DENIED" {
		t.Fatalf("scoped entity without actor tenant should be denied, got %+v", scopedNoTenant)
	}

	// Scoped entity with actor tenantId has where constraint
	scopedWithTenant := eng.AuthorizeRead("Scoped", adminWithTenant)
	if !scopedWithTenant.Allowed || scopedWithTenant.Where == nil {
		t.Fatalf("scoped entity should have where constraint, got %+v", scopedWithTenant)
	}

	// Soft deleted entity
	softScope := eng.AuthorizeRead("SoftDeleted", nil)
	if !softScope.Allowed || softScope.Where == nil {
		t.Fatalf("soft deleted entity should have where constraint, got %+v", softScope)
	}

	// Uncompiled string readFilter refused as READ_FILTER_NOT_COMPILED
	brokenScope := eng.AuthorizeRead("BrokenDoc", adminWithTenant)
	if brokenScope.Allowed || brokenScope.Code != "READ_FILTER_NOT_COMPILED" {
		t.Fatalf("uncompiled readFilter must return READ_FILTER_NOT_COMPILED, got %+v", brokenScope)
	}

	// Combined tenant and readFilter
	docScope := eng.AuthorizeRead("Doc", adminWithTenant)
	if !docScope.Allowed || docScope.Where == nil {
		t.Fatalf("doc scope should be allowed with where, got %+v", docScope)
	}
	whereArr, ok := docScope.Where.([]any)
	if !ok || len(whereArr) < 3 || whereArr[0] != "and" {
		t.Fatalf("combined where should be an 'and' tuple, got %v", docScope.Where)
	}

	// In-memory evaluation via EvalFilter
	matchingRecord := map[string]any{"tenantId": "tenant-a", "ownerId": "u-1"}
	if !eng.EvalFilter(docScope.Where, matchingRecord, adminWithTenant) {
		t.Fatalf("matching record should evaluate to true under docScope.Where")
	}

	wrongTenantRecord := map[string]any{"tenantId": "tenant-b", "ownerId": "u-1"}
	if eng.EvalFilter(docScope.Where, wrongTenantRecord, adminWithTenant) {
		t.Fatalf("wrong tenant record should evaluate to false under docScope.Where")
	}

	wrongOwnerRecord := map[string]any{"tenantId": "tenant-a", "ownerId": "u-2"}
	if eng.EvalFilter(docScope.Where, wrongOwnerRecord, adminWithTenant) {
		t.Fatalf("wrong owner record should evaluate to false under docScope.Where")
	}
}

