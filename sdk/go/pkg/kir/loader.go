// Package kir provides intermediate representation loading and unmarshaling.
package kir

import (
	"encoding/json"
	"os"
)

// Document represents a compiled Kerangka Intermediate Representation document.
type Document struct {
	Schema       string            `json:"$schema,omitempty"`
	KIR          string            `json:"kir"`
	App          string            `json:"app"`
	Meta         map[string]any    `json:"meta"`
	Roles        []string          `json:"roles,omitempty"`
	Multitenancy map[string]any    `json:"multitenancy,omitempty"`
	Entities     map[string]Entity `json:"entities"`
	Events       map[string]any    `json:"events,omitempty"`
	Decisions    map[string]any    `json:"decisions,omitempty"`
	Schedules    map[string]any    `json:"schedules,omitempty"`
	Extensions   map[string]any    `json:"extensions,omitempty"`
}

// Entity represents an entity specification in KIR.
type Entity struct {
	Key         string         `json:"key"`
	Embedded    bool           `json:"embedded"`
	Fields      map[string]any `json:"fields"`
	Rules       []any          `json:"rules,omitempty"`
	Invariants  []any          `json:"invariants,omitempty"`
	Permissions map[string]any `json:"permissions,omitempty"`
	Workflow    map[string]any `json:"workflow,omitempty"`
	Actions     map[string]any `json:"actions,omitempty"`
}

// LoadFile reads and decodes a KIR JSON file from disk.
func LoadFile(path string) (*Document, error) {
	bytes, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var doc Document
	if err := json.Unmarshal(bytes, &doc); err != nil {
		return nil, err
	}
	return &doc, nil
}
