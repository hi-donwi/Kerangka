# ADR-0047: Hono Actor and Tenant Context Is Owned by the Host

- **Date:** 2026-10-16
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

KX-01 in the host-embedding RFC identifies an authority boundary left open by ADR-0040:
Hono reads actor id, roles and tenant from self-asserted headers or a query parameter.
Permissions and read filters cannot isolate callers if the caller chooses the principal.
The adapter also fetches item records without tenant scope, and caches idempotent responses
under the raw client key, allowing a response to outlive the authority that produced it.

## Decision

The Hono adapter accepts `resolveContext(request): Promise<ActorContext | null>`. The host
authenticates the request and checks current membership and roles. The adapter calls the hook
once per data request, snapshots the returned context, and uses it for every authorization,
store call, screen, MCP execution and effect in that request. `ActorContext.id` remains the
existing actor identifier; no second `actorId` property is introduced.

A supplied resolver is authoritative. A null result is anonymous and never falls back to
headers, even if `trustContextHeaders` is also true. A resolver failure produces a generic
500 problem, touches no application data and exposes no backend message.
The adapter passes an explicit anonymous actor with `roles: []` to the engine, preventing its
legacy overloads from interpreting a request body's `roles` as the caller's identity.

Without a resolver, context headers and `?tenantId=` are ignored unless the host explicitly
sets `trustContextHeaders: true`. This is a development harness or a trusted-proxy contract,
not authentication. A production proxy using it must strip client-supplied context headers.

For a model declaring `multitenancy`, data requests without a nonempty tenant fail with
403 `TENANT_REQUIRED` before store access or idempotency replay. Public metadata, static UIDL
and CORS preflight remain available without resolving a principal. Non-multitenant models
keep their declared permission semantics: unrestricted entities remain public.

Item lookups pass the verified tenant to the store. A record outside that scope is not found
and answers 404; no unscoped lookup is made to distinguish it from an absent record. This
supersedes ADR-0040's item-lookup instruction to load a foreign row to return 403. Read filters
still check rows the scoped store returns, including conditional reads and soft deletion.

Creates bind an omitted tenant discriminator to the context before validation. Input and
computed/action/transition output cannot change that discriminator to a different tenant.
The declared discriminator field defaults to `tenantId`.

Idempotency storage keys include the application and a fingerprint of the full context, not
just the client key. Different tenants, actors, roles or other verified claims cannot replay
each other's results. Resolving context on every request lets a host denial or revoked role
take effect before a prior success could be replayed.

## Consequences

### Positive

- Forged identity headers cannot override a verified principal.
- Actor, tenant and cache scope cannot drift within one request.
- Missing tenant scope is an explicit failure, not an unscoped store operation.

### Negative

- Existing Hono development hosts must opt into context headers explicitly.
- Hosts implement authentication and current membership checks; the adapter supplies neither.
- Previously cached unscoped idempotency entries are not replayed after migration.
- Cross-tenant item requests change from 403 to 404.

### Neutral

- This slice covers Hono only. The separate Node sidecar used by `kerangka dev`, and other
  language adapters, require their own KX-01 migrations; they are not secured by this change.
- Store adapters still own correct tenant isolation and atomicity behind `StorePort`.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| Always trust context headers | Any caller could choose its own tenant and roles |
| Fall back to headers when a resolver returns null | A host denial would grant self-asserted authority |
| Resolve actor and tenant independently in every handler | Different calls could authorize and persist under different contexts |
| Fix only record queries, leaving raw idempotency keys | A cache hit could return another principal's prior result |

## Follow-up

- Hono regression tests cover forged headers, missing tenant, concurrent contexts and revoked roles.
- Migrate Node and other language adapters in separate KX-01 slices before claiming adapter-wide completion.
