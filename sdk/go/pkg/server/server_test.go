package server_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/hi-donwi/kerangka/sdk/go/pkg/kir"
	"github.com/hi-donwi/kerangka/sdk/go/pkg/server"
)

func sampleDocument() *kir.Document {
	return &kir.Document{
		KIR: "0.1",
		App: "test-task-app",
		Entities: map[string]kir.Entity{
			"Task": {
				Fields: map[string]any{
					"id": map[string]any{
						"type":     "string",
						"required": true,
					},
					"title": map[string]any{
						"type":     "string",
						"required": true,
					},
					"status": map[string]any{
						"type":    "enum",
						"values":  []any{"PENDING", "COMPLETED"},
						"default": "PENDING",
					},
				},
				Workflow: map[string]any{
					"field": "status",
					"transitions": map[string]any{
						"complete": map[string]any{
							"from": "PENDING",
							"to":   "COMPLETED",
							"then": []any{
								map[string]any{
									"emit": "TaskCompleted",
								},
							},
						},
					},
				},
			},
		},
	}
}

func TestServerHealth(t *testing.T) {
	doc := sampleDocument()
	srv := server.New(doc, nil)

	req := httptest.NewRequest("GET", "/health", nil)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var res map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &res); err != nil {
		t.Fatal(err)
	}
	if res["app"] != "test-task-app" {
		t.Fatalf("expected app 'test-task-app', got '%v'", res["app"])
	}
}

func TestServerCreateAndValidate(t *testing.T) {
	doc := sampleDocument()
	srv := server.New(doc, nil)

	// Missing required field 'title'
	invalidBody := bytes.NewBufferString(`{"id":"t-1"}`)
	req := httptest.NewRequest("POST", "/api/Task", invalidBody)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusUnprocessableEntity {
		t.Fatalf("expected 422 for missing required field, got %d", w.Code)
	}

	// Valid creation
	validBody := bytes.NewBufferString(`{"id":"t-1","title":"Ship Phase 5"}`)
	req2 := httptest.NewRequest("POST", "/api/Task", validBody)
	w2 := httptest.NewRecorder()
	srv.ServeHTTP(w2, req2)

	if w2.Code != http.StatusCreated {
		t.Fatalf("expected 201 Created, got %d: %s", w2.Code, w2.Body.String())
	}

	var created map[string]any
	if err := json.Unmarshal(w2.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}
	if created["status"] != "PENDING" {
		t.Fatalf("expected default status PENDING, got %v", created["status"])
	}

	// Fetch via GET
	req3 := httptest.NewRequest("GET", "/api/Task/t-1", nil)
	w3 := httptest.NewRecorder()
	srv.ServeHTTP(w3, req3)

	if w3.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w3.Code)
	}
}

func TestServerWorkflowTransition(t *testing.T) {
	doc := sampleDocument()
	srv := server.New(doc, nil)

	// Create task
	validBody := bytes.NewBufferString(`{"id":"t-2","title":"Complete Transition Test"}`)
	req := httptest.NewRequest("POST", "/api/Task", validBody)
	w := httptest.NewRecorder()
	srv.ServeHTTP(w, req)

	if w.Code != http.StatusCreated {
		t.Fatalf("failed to create task: %d", w.Code)
	}

	// Fire transition 'complete'
	reqTr := httptest.NewRequest("POST", "/api/Task/t-2/transitions/complete", nil)
	wTr := httptest.NewRecorder()
	srv.ServeHTTP(wTr, reqTr)

	if wTr.Code != http.StatusOK {
		t.Fatalf("expected 200 for transition, got %d: %s", wTr.Code, wTr.Body.String())
	}

	var trResult map[string]any
	if err := json.Unmarshal(wTr.Body.Bytes(), &trResult); err != nil {
		t.Fatal(err)
	}

	rec, ok := trResult["record"].(map[string]any)
	if !ok {
		t.Fatalf("missing record in response")
	}
	if rec["status"] != "COMPLETED" {
		t.Fatalf("expected status COMPLETED, got %v", rec["status"])
	}
}
