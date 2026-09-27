// Package server provides a standard net/http REST adapter for Kerangka models in Go.
package server

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"sync"

	"github.com/hi-donwi/kerangka/sdk/go/pkg/engine"
	"github.com/hi-donwi/kerangka/sdk/go/pkg/kir"
	"github.com/hi-donwi/kerangka/sdk/go/pkg/ports"
)

// Server is the HTTP server adapter running Kerangka engine and store.
type Server struct {
	doc    *kir.Document
	engine *engine.ReferenceEngine
	store  ports.StorePort
	mux    *http.ServeMux
}

// New creates a new Kerangka HTTP Server adapter.
func New(doc *kir.Document, store ports.StorePort) *Server {
	if store == nil {
		store = NewMemoryStore()
	}
	s := &Server{
		doc:    doc,
		engine: engine.New(doc),
		store:  store,
		mux:    http.NewServeMux(),
	}
	s.routes()
	return s
}

// ServeHTTP implements http.Handler.
func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /health", s.handleHealth)
	s.mux.HandleFunc("GET /api/{entity}", s.handleList)
	s.mux.HandleFunc("POST /api/{entity}", s.handleCreate)
	s.mux.HandleFunc("GET /api/{entity}/{id}", s.handleGet)
	s.mux.HandleFunc("PUT /api/{entity}/{id}", s.handleUpdate)
	s.mux.HandleFunc("DELETE /api/{entity}/{id}", s.handleDelete)
	s.mux.HandleFunc("POST /api/{entity}/{id}/transitions/{transition}", s.handleTransition)
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
		"app":    s.doc.App,
		"kir":    s.doc.KIR,
	})
}

func (s *Server) handleList(w http.ResponseWriter, r *http.Request) {
	entity := r.PathValue("entity")
	if _, ok := s.doc.Entities[entity]; !ok {
		writeProblem(w, http.StatusNotFound, "Entity Not Found", fmt.Sprintf("Unknown entity '%s'", entity))
		return
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	result, err := s.store.Find(r.Context(), entity, nil, ports.QueryOptions{
		TenantID: tenantID,
		Limit:    100,
	})
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Storage Error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, result)
}

func (s *Server) handleGet(w http.ResponseWriter, r *http.Request) {
	entity := r.PathValue("entity")
	id := r.PathValue("id")
	if _, ok := s.doc.Entities[entity]; !ok {
		writeProblem(w, http.StatusNotFound, "Entity Not Found", fmt.Sprintf("Unknown entity '%s'", entity))
		return
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	record, err := s.store.Get(r.Context(), entity, id, tenantID)
	if err != nil || record == nil {
		writeProblem(w, http.StatusNotFound, "Not Found", fmt.Sprintf("Record '%s' not found in entity '%s'", id, entity))
		return
	}

	writeJSON(w, http.StatusOK, record)
}

func (s *Server) handleCreate(w http.ResponseWriter, r *http.Request) {
	entity := r.PathValue("entity")
	if _, ok := s.doc.Entities[entity]; !ok {
		writeProblem(w, http.StatusNotFound, "Entity Not Found", fmt.Sprintf("Unknown entity '%s'", entity))
		return
	}

	var payload map[string]any
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid JSON", err.Error())
		return
	}

	// Validate against invariants and rules
	valRes := s.engine.Validate(entity, payload)
	if !valRes.Valid {
		invalidParams := make([]map[string]any, len(valRes.Errors))
		for i, e := range valRes.Errors {
			invalidParams[i] = map[string]any{
				"name":    e.Field,
				"reason":  e.Message,
				"code":    e.Code,
			}
		}
		writeJSON(w, http.StatusUnprocessableEntity, map[string]any{
			"type":           "https://kerangka.dev/errors/validation-error",
			"title":          "Validation Failed",
			"status":         http.StatusUnprocessableEntity,
			"detail":         "One or more validation constraints were violated",
			"invalid-params": invalidParams,
		})
		return
	}

	// Compute defaults and derived fields
	computed := s.engine.Compute(entity, payload)

	tenantID := r.Header.Get("X-Tenant-ID")
	created, err := s.store.Create(r.Context(), entity, computed, tenantID)
	if err != nil {
		writeProblem(w, http.StatusInternalServerError, "Storage Error", err.Error())
		return
	}

	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) handleUpdate(w http.ResponseWriter, r *http.Request) {
	entity := r.PathValue("entity")
	id := r.PathValue("id")
	if _, ok := s.doc.Entities[entity]; !ok {
		writeProblem(w, http.StatusNotFound, "Entity Not Found", fmt.Sprintf("Unknown entity '%s'", entity))
		return
	}

	var patch map[string]any
	if err := json.NewDecoder(r.Body).Decode(&patch); err != nil {
		writeProblem(w, http.StatusBadRequest, "Invalid JSON", err.Error())
		return
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	updated, err := s.store.Update(r.Context(), entity, id, patch, tenantID)
	if err != nil {
		writeProblem(w, http.StatusNotFound, "Not Found", err.Error())
		return
	}

	computed := s.engine.Compute(entity, updated)
	writeJSON(w, http.StatusOK, computed)
}

func (s *Server) handleDelete(w http.ResponseWriter, r *http.Request) {
	entity := r.PathValue("entity")
	id := r.PathValue("id")
	if _, ok := s.doc.Entities[entity]; !ok {
		writeProblem(w, http.StatusNotFound, "Entity Not Found", fmt.Sprintf("Unknown entity '%s'", entity))
		return
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	if err := s.store.Delete(r.Context(), entity, id, tenantID); err != nil {
		writeProblem(w, http.StatusNotFound, "Not Found", err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) handleTransition(w http.ResponseWriter, r *http.Request) {
	entity := r.PathValue("entity")
	id := r.PathValue("id")
	transition := r.PathValue("transition")

	if _, ok := s.doc.Entities[entity]; !ok {
		writeProblem(w, http.StatusNotFound, "Entity Not Found", fmt.Sprintf("Unknown entity '%s'", entity))
		return
	}

	tenantID := r.Header.Get("X-Tenant-ID")
	existing, err := s.store.Get(r.Context(), entity, id, tenantID)
	if err != nil || existing == nil {
		writeProblem(w, http.StatusNotFound, "Not Found", fmt.Sprintf("Record '%s' not found", id))
		return
	}

	// Parse actor roles from header
	var actorRoles []string
	if rolesHeader := r.Header.Get("X-Actor-Roles"); rolesHeader != "" {
		for _, r := range strings.Split(rolesHeader, ",") {
			actorRoles = append(actorRoles, strings.TrimSpace(r))
		}
	}

	result, err := s.engine.Transition(entity, existing, transition, actorRoles)
	if err != nil || !result.OK {
		status := http.StatusUnprocessableEntity
		if result.Error == "PERMISSION_DENIED" {
			status = http.StatusForbidden
		}
		writeProblem(w, status, "Transition Failed", result.Message)
		return
	}

	// Persist the transitioned state
	if _, err := s.store.Update(r.Context(), entity, id, result.Record, tenantID); err != nil {
		writeProblem(w, http.StatusInternalServerError, "Storage Error", err.Error())
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"record": result.Record,
		"events": result.Events,
	})
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func writeProblem(w http.ResponseWriter, status int, title, detail string) {
	w.Header().Set("Content-Type", "application/problem+json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(map[string]any{
		"type":   "https://kerangka.dev/errors/problem",
		"title":  title,
		"status": status,
		"detail": detail,
	})
}

// MemoryStore is an in-memory thread-safe implementation of ports.StorePort.
type MemoryStore struct {
	mu   sync.RWMutex
	data map[string]map[string]map[string]any // entity -> id -> record
}

// NewMemoryStore creates a thread-safe in-memory store.
func NewMemoryStore() *MemoryStore {
	return &MemoryStore{
		data: make(map[string]map[string]map[string]any),
	}
}

func (m *MemoryStore) Get(ctx context.Context, entityName string, id string, tenantID string) (map[string]any, error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	entityData, ok := m.data[entityName]
	if !ok {
		return nil, nil
	}
	record, ok := entityData[id]
	if !ok {
		return nil, nil
	}
	return cloneMap(record), nil
}

func (m *MemoryStore) Find(ctx context.Context, entityName string, filter map[string]any, opts ports.QueryOptions) (*ports.QueryResult[map[string]any], error) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	var items []map[string]any
	if entityData, ok := m.data[entityName]; ok {
		for _, rec := range entityData {
			items = append(items, cloneMap(rec))
		}
	}
	return &ports.QueryResult[map[string]any]{
		Items: items,
		Total: len(items),
		Limit: opts.Limit,
	}, nil
}

func (m *MemoryStore) Create(ctx context.Context, entityName string, record map[string]any, tenantID string) (map[string]any, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if _, ok := m.data[entityName]; !ok {
		m.data[entityName] = make(map[string]map[string]any)
	}

	id, _ := record["id"].(string)
	if id == "" {
		id = fmt.Sprintf("rec-%d", len(m.data[entityName])+1)
		record["id"] = id
	}

	m.data[entityName][id] = cloneMap(record)
	return cloneMap(record), nil
}

func (m *MemoryStore) Update(ctx context.Context, entityName string, id string, patch map[string]any, tenantID string) (map[string]any, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	entityData, ok := m.data[entityName]
	if !ok {
		return nil, fmt.Errorf("entity '%s' not found", entityName)
	}
	record, ok := entityData[id]
	if !ok {
		return nil, fmt.Errorf("record '%s' not found", id)
	}

	for k, v := range patch {
		record[k] = v
	}
	entityData[id] = record
	return cloneMap(record), nil
}

func (m *MemoryStore) Delete(ctx context.Context, entityName string, id string, tenantID string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if entityData, ok := m.data[entityName]; ok {
		delete(entityData, id)
	}
	return nil
}

func (m *MemoryStore) Transaction(ctx context.Context, fn func(txStore ports.StorePort) error) error {
	return fn(m)
}

func cloneMap(m map[string]any) map[string]any {
	res := make(map[string]any, len(m))
	for k, v := range m {
		res[k] = v
	}
	return res
}
