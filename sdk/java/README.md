# Kerangka Java SDK

Specification Version: 0.1
Status: Scaffolding / Draft
License: Apache-2.0

## Overview

The Kerangka Java SDK targets Java 21+ and integrates natively with Quarkus, Panache, and Jackson for reactive or synchronous execution of Kerangka models.

## Features

- Java 21 Records for immutable intermediate representation entities.
- Non-blocking `CompletableFuture` / Mutiny-ready port interfaces (`StorePort`, `BusPort`, `CachePort`).
- Zero reflection overhead during model execution.

## Quarkus Integration

```java
@ApplicationScoped
public class InvoiceService {
    @Inject
    StorePort store;

    public Uni<Invoice> getInvoice(String id, String tenantId) {
        return Uni.createFrom().completionStage(() ->
            store.get("Invoice", id, tenantId, Invoice.class)
        ).onItem().ifNull().failWith(new NotFoundException());
    }
}
```
