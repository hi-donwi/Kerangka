// Package ports defines the standard runtime port interfaces for Kerangka in Go.
package ports

import "context"

// QueryOptions specifies pagination, sorting, and tenant scoping.
type QueryOptions struct {
	TenantID string
	Limit    int
	Offset   int
	Sort     map[string]string
}

// QueryResult encapsulates query items and total matching record count.
type QueryResult[T any] struct {
	Items  []T
	Total  int
	Limit  int
	Offset int
}

// StorePort defines the persistence contract for entities.
type StorePort interface {
	Get(ctx context.Context, entityName string, id string, tenantID string) (map[string]any, error)
	Find(ctx context.Context, entityName string, filter map[string]any, opts QueryOptions) (*QueryResult[map[string]any], error)
	Create(ctx context.Context, entityName string, record map[string]any, tenantID string) (map[string]any, error)
	Update(ctx context.Context, entityName string, id string, patch map[string]any, tenantID string) (map[string]any, error)
	Delete(ctx context.Context, entityName string, id string, tenantID string) error
	Transaction(ctx context.Context, fn func(txStore StorePort) error) error
}

// BusPort defines the event publishing and subscription contract.
type BusPort interface {
	Publish(ctx context.Context, event string, payload any, metadata map[string]any) error
	Subscribe(ctx context.Context, event string, handler func(payload any, metadata map[string]any) error) (func(), error)
}

// CachePort defines the key-value caching contract.
type CachePort interface {
	Get(ctx context.Context, key string) (any, error)
	Set(ctx context.Context, key string, value any, ttlSeconds int) error
	Delete(ctx context.Context, key string) error
	InvalidatePattern(ctx context.Context, pattern string) error
}
