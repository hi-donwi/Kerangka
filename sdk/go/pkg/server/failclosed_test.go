package server_test

// The Go engine has no expression evaluator yet. Whatever it cannot decide (a guard, a
// conditional permission, a read filter) it must refuse rather than skip: skipping grants
// what the model forbids (ADR-0008, ADR-0044). These tests failed against the previous server,
// which enforced no entity permissions, ignored guards, and stored updates unvalidated.

import (
	"bytes"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/hi-donwi/kerangka/sdk/go/pkg/kir"
	"github.com/hi-donwi/kerangka/sdk/go/pkg/server"
)

func guardedDocument() *kir.Document {
	return &kir.Document{
		KIR: "0.1",
		App: "fail-closed",
		Entities: map[string]kir.Entity{
			"Invoice": {
				Fields: map[string]any{
					"id":     map[string]any{"type": "string", "required": true},
					"number": map[string]any{"type": "string", "required": true},
					"status": map[string]any{"type": "enum", "values": []any{"draft", "sent"}, "default": "draft"},
				},
				Permissions: map[string]any{
					"read":   []any{"admin", "billing", "viewer"},
					"create": []any{"admin", "billing"},
					"update": map[string]any{"admin": true, "billing": "status == 'draft'"},
					"delete": []any{},
				},
				Workflow: map[string]any{
					"field": "status",
					"transitions": map[string]any{
						"send": map[string]any{"from": "draft", "to": "sent", "when": map[string]any{"$expr": "today", "args": []any{}}},
					},
				},
			},
			"Note": {
				Fields:     map[string]any{"id": map[string]any{"type": "string", "required": true}},
				ReadFilter: []any{"==", []any{"get", "ownerId"}, []any{"actor", "id"}},
			},
		},
	}
}

func do(t *testing.T, srv http.Handler, method, path, roles, body string) *httptest.ResponseRecorder {
	t.Helper()
	var reader *bytes.Buffer
	if body != "" {
		reader = bytes.NewBufferString(body)
	} else {
		reader = bytes.NewBufferString("")
	}
	req := httptest.NewRequest(method, path, reader)
	if roles != "" {
		req.Header.Set("X-Actor-Roles", roles)
	}
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)
	return w
}

func seeded(t *testing.T) http.Handler {
	t.Helper()
	srv := server.New(guardedDocument(), nil)
	if w := do(t, srv, "POST", "/api/Invoice", "admin", `{"id":"inv-1","number":"A-1","status":"draft"}`); w.Code != http.StatusCreated {
		t.Fatalf("seed: expected 201, got %d: %s", w.Code, w.Body.String())
	}
	return srv
}

func TestCreateRequiresAListedRole(t *testing.T) {
	srv := server.New(guardedDocument(), nil)
	if w := do(t, srv, "POST", "/api/Invoice", "viewer", `{"id":"x","number":"X"}`); w.Code != http.StatusForbidden {
		t.Fatalf("viewer create: expected 403, got %d", w.Code)
	}
	if w := do(t, srv, "POST", "/api/Invoice", "", `{"id":"x","number":"X"}`); w.Code != http.StatusForbidden {
		t.Fatalf("anonymous create: expected 403, got %d", w.Code)
	}
}

func TestUpdateHonoursTheRoleMap(t *testing.T) {
	srv := seeded(t)
	if w := do(t, srv, "PUT", "/api/Invoice/inv-1", "viewer", `{"number":"V"}`); w.Code != http.StatusForbidden {
		t.Fatalf("viewer update: expected 403, got %d", w.Code)
	}
	if w := do(t, srv, "PUT", "/api/Invoice/inv-1", "admin", `{"number":"A-2"}`); w.Code != http.StatusOK {
		t.Fatalf("admin update: expected 200, got %d: %s", w.Code, w.Body.String())
	}
	// billing's grant is a condition this engine cannot evaluate: refused, not guessed.
	if w := do(t, srv, "PUT", "/api/Invoice/inv-1", "billing", `{"number":"B"}`); w.Code != http.StatusNotImplemented {
		t.Fatalf("billing update: expected 501, got %d", w.Code)
	}
}

func TestUpdateIsValidated(t *testing.T) {
	srv := seeded(t)
	if w := do(t, srv, "PUT", "/api/Invoice/inv-1", "admin", `{"status":"archived"}`); w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("invalid update: expected 422, got %d", w.Code)
	}
}

func TestAnEmptyListGrantsNoOne(t *testing.T) {
	srv := seeded(t)
	if w := do(t, srv, "DELETE", "/api/Invoice/inv-1", "admin", ""); w.Code != http.StatusForbidden {
		t.Fatalf("admin delete: expected 403, got %d", w.Code)
	}
}

func TestAGuardIsRefusedNotSkipped(t *testing.T) {
	srv := seeded(t)
	if w := do(t, srv, "POST", "/api/Invoice/inv-1/transitions/send", "admin", ""); w.Code != http.StatusNotImplemented {
		t.Fatalf("guarded transition: expected 501, got %d: %s", w.Code, w.Body.String())
	}
}

func TestAReadFilterIsRefusedNotSkipped(t *testing.T) {
	srv := server.New(guardedDocument(), nil)
	if w := do(t, srv, "GET", "/api/Note", "admin", ""); w.Code != http.StatusNotImplemented {
		t.Fatalf("list under read filter: expected 501, got %d", w.Code)
	}
	if w := do(t, srv, "GET", "/api/Note/n-1", "admin", ""); w.Code != http.StatusNotImplemented {
		t.Fatalf("get under read filter: expected 501, got %d", w.Code)
	}
}
