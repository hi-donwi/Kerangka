package dev.kerangka.ports;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.CompletableFuture;

/**
 * Kerangka Store Port Contract in Java 21.
 */
public interface StorePort {

    record QueryOptions(
        String tenantId,
        int limit,
        int offset,
        Map<String, String> sort
    ) {}

    record QueryResult<T>(
        List<T> items,
        long total,
        int limit,
        int offset
    ) {}

    <T> CompletableFuture<Optional<T>> get(String entityName, String id, String tenantId, Class<T> type);

    <T> CompletableFuture<QueryResult<T>> find(String entityName, Map<String, Object> filter, QueryOptions options, Class<T> type);

    <T> CompletableFuture<T> create(String entityName, T record, String tenantId);

    <T> CompletableFuture<T> update(String entityName, String id, Map<String, Object> patch, String tenantId);

    CompletableFuture<Boolean> delete(String entityName, String id, String tenantId);
}
