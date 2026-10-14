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

func TestDecisionTables(t *testing.T) {
	doc := &kir.Document{
		KIR: "0.1",
		App: "routing",
		Decisions: map[string]any{
			"approverRouting": map[string]any{
				"hitPolicy": "first",
				"inputs": []any{
					map[string]any{"name": "days", "type": "int"},
				},
				"outputs": []any{
					map[string]any{"name": "approverRole", "type": "string"},
				},
				"rows": []any{
					map[string]any{"days": "<= 2", "approverRole": "team-lead"},
					map[string]any{"days": "<= 5", "approverRole": "department-manager"},
					map[string]any{"days": "> 5", "approverRole": "hr-director"},
				},
			},
			"uniquePolicy": map[string]any{
				"hitPolicy": "unique",
				"inputs": []any{
					map[string]any{"name": "code", "type": "string"},
				},
				"outputs": []any{
					map[string]any{"name": "label", "type": "string"},
				},
				"rules": []any{
					map[string]any{"inputs": []any{"A"}, "outputs": map[string]any{"label": "Active"}},
					map[string]any{"inputs": []any{"A"}, "outputs": map[string]any{"label": "Alternate"}},
				},
			},
			"featureFlags": map[string]any{
				"hitPolicy": "collect",
				"inputs": []any{
					map[string]any{"name": "role", "type": "string"},
				},
				"outputs": []any{
					map[string]any{"name": "feature", "type": "string"},
				},
				"rules": []any{
					map[string]any{"inputs": []any{"admin"}, "outputs": map[string]any{"feature": "export_csv"}},
					map[string]any{"inputs": []any{"admin"}, "outputs": map[string]any{"feature": "manage_users"}},
					map[string]any{"inputs": []any{"user"}, "outputs": map[string]any{"feature": "read_only"}},
				},
			},
		},
		Entities: map[string]kir.Entity{
			"LeaveRequest": {
				Key: "id",
				Fields: map[string]any{
					"days": map[string]any{"type": "int"},
					"approverRole": map[string]any{
						"type":    "string",
						"compute": "approverRouting(days)",
					},
				},
			},
		},
	}

	eng := New(doc)

	// 1. Canonical rows with first hit policy
	short := eng.Decide("approverRouting", map[string]any{"days": 2})
	if !short.Matched {
		t.Fatalf("expected short request to match: %+v", short)
	}
	shortOutputs, ok := short.Outputs.(map[string]any)
	if !ok || shortOutputs["approverRole"] != "team-lead" {
		t.Fatalf("expected team-lead, got: %v", short.Outputs)
	}

	med := eng.Decide("approverRouting", map[string]any{"days": 4})
	if !med.Matched || med.Outputs.(map[string]any)["approverRole"] != "department-manager" {
		t.Fatalf("expected department-manager, got: %v", med.Outputs)
	}

	long := eng.Decide("approverRouting", map[string]any{"days": 9})
	if !long.Matched || long.Outputs.(map[string]any)["approverRole"] != "hr-director" {
		t.Fatalf("expected hr-director, got: %v", long.Outputs)
	}

	// 2. Compute integration
	computed := eng.Compute("LeaveRequest", map[string]any{"days": 4})
	if computed["approverRole"] != "department-manager" {
		t.Fatalf("expected computed approverRole department-manager, got: %v", computed["approverRole"])
	}

	// 3. Unique hit policy violation
	uniqRes := eng.Decide("uniquePolicy", map[string]any{"code": "A"})
	if uniqRes.Matched || uniqRes.Code != "UNIQUE_VIOLATION" {
		t.Fatalf("expected UNIQUE_VIOLATION, got: %+v", uniqRes)
	}

	// 4. Collect hit policy
	collectRes := eng.Decide("featureFlags", map[string]any{"role": "admin"})
	if !collectRes.Matched || collectRes.HitCount != 2 {
		t.Fatalf("expected 2 hits for collect hit policy, got: %+v", collectRes)
	}
	collectList, ok := collectRes.Outputs.([]map[string]any)
	if !ok || len(collectList) != 2 {
		t.Fatalf("expected slice of 2 outputs, got: %v", collectRes.Outputs)
	}

	// 5. No match
	noMatch := eng.Decide("approverRouting", map[string]any{"days": "invalid"})
	if noMatch.Matched || noMatch.Code != "DECISION_NO_MATCH" {
		t.Fatalf("expected DECISION_NO_MATCH, got: %+v", noMatch)
	}

	// 6. Table not found
	notFound := eng.Decide("nonExistent", map[string]any{})
	if notFound.Matched || notFound.Code != "TABLE_NOT_FOUND" {
		t.Fatalf("expected TABLE_NOT_FOUND, got: %+v", notFound)
	}
}

func TestDecimalWireDecoding(t *testing.T) {
	doc := &kir.Document{
		KIR: "0.1",
		App: "store",
		Entities: map[string]kir.Entity{
			"Product": {
				Key: "sku",
				Fields: map[string]any{
					"sku":   map[string]any{"type": "string"},
					"price": map[string]any{"type": "decimal"},
				},
			},
		},
	}

	eng := New(doc)

	// Valid decimal string decoded to float64
	decoded := eng.DecodeRecord("Product", map[string]any{
		"sku":   "SKU-1",
		"price": "150.00",
	})
	if p, ok := decoded["price"].(float64); !ok || p != 150.0 {
		t.Fatalf("expected price 150.0 float64, got %v (%T)", decoded["price"], decoded["price"])
	}

	// Negative decimal
	negDecoded := eng.DecodeRecord("Product", map[string]any{
		"sku":   "SKU-2",
		"price": "-5.50",
	})
	if p, ok := negDecoded["price"].(float64); !ok || p != -5.5 {
		t.Fatalf("expected price -5.5 float64, got %v", negDecoded["price"])
	}

	// Validation fails on non-numeric string for decimal field
	valRes := eng.Validate("Product", map[string]any{
		"sku":   "SKU-3",
		"price": "not-a-decimal",
	})
	if valRes.Valid {
		t.Fatalf("expected validation failure for invalid decimal")
	}
	foundInvalid := false
	for _, e := range valRes.Errors {
		if e.Code == "INVALID_DECIMAL" {
			foundInvalid = true
			break
		}
	}
	if !foundInvalid {
		t.Fatalf("expected INVALID_DECIMAL error code, got %+v", valRes.Errors)
	}
}

func TestBuiltInFunctions(t *testing.T) {
	eval := func(tuple []any) any {
		res := evalTuple(tuple, nil, nil)
		if !res.Supported {
			t.Fatalf("expected supported outcome for %v", tuple)
		}
		return res.Value
	}

	if eval([]any{"abs", -42.0}) != 42.0 {
		t.Fatalf("abs(-42) failed")
	}
	if eval([]any{"round", 3.14159, 2}) != 3.14 {
		t.Fatalf("round(3.14159, 2) failed")
	}
	if eval([]any{"min", 10.0, 20.0}) != 10.0 {
		t.Fatalf("min(10, 20) failed")
	}
	if eval([]any{"max", 10.0, 20.0}) != 20.0 {
		t.Fatalf("max(10, 20) failed")
	}
	if eval([]any{"lower", "HELLO"}) != "hello" {
		t.Fatalf("lower('HELLO') failed")
	}
	if eval([]any{"upper", "world"}) != "WORLD" {
		t.Fatalf("upper('world') failed")
	}
	if eval([]any{"trim", "  hello  "}) != "hello" {
		t.Fatalf("trim('  hello  ') failed")
	}
	if eval([]any{"len", "hello"}) != 5 {
		t.Fatalf("len('hello') failed")
	}
	if eval([]any{"contains", "kerangka", "rang"}) != true {
		t.Fatalf("contains('kerangka', 'rang') failed")
	}
	if eval([]any{"startsWith", "kerangka", "ker"}) != true {
		t.Fatalf("startsWith('kerangka', 'ker') failed")
	}
	if eval([]any{"concat", "foo", "bar", "baz"}) != "foobarbaz" {
		t.Fatalf("concat('foo', 'bar', 'baz') failed")
	}
	if eval([]any{"coalesce", nil, nil, "first"}) != "first" {
		t.Fatalf("coalesce failed")
	}
}



