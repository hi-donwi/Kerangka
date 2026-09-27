package dev.kerangka.kir;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;
import java.util.Map;

/**
 * Canonical Intermediate Representation model record in Java 21.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record KirDocument(
    String kir,
    String app,
    Map<String, Object> meta,
    List<String> roles,
    Map<String, Object> multitenancy,
    Map<String, EntityDefinition> entities
) {
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record EntityDefinition(
        String key,
        boolean embedded,
        Map<String, Object> fields,
        List<Object> rules,
        List<Object> invariants,
        Map<String, Object> permissions,
        Map<String, Object> workflow,
        Map<String, Object> actions
    ) {}
}
