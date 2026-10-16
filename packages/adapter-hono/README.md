# Hono Adapter

`createKerangkaHonoApp(kir, options)` mounts the model's REST, MCP and UIDL screen routes.
Authorization uses the engine's permissions and read filters; authentication belongs to the host.

## Verified Request Context

Pass a resolver that authenticates the request and verifies the actor's current tenant membership
and roles. It receives a standard Web `Request` and returns the existing `ActorContext` shape:
`{ id, roles, tenantId }`, or `null` when no principal is established.

```ts
import { createKerangkaHonoApp, type KerangkaHonoOptions } from "@kerangka/adapter-hono";
import type { KIRDocument } from "@kerangka/compiler";
import type { StorePort } from "@kerangka/ports";

export function createHostApp(
  kir: KIRDocument,
  store: StorePort,
  authenticate: NonNullable<KerangkaHonoOptions["resolveContext"]>
) {
  return createKerangkaHonoApp(kir, { store, resolveContext: authenticate });
}
```

The host must implement `authenticate`; copying `X-Actor-*`, `X-Tenant-Id` or `?tenantId=` into
its return value is not authentication. Check active membership and role revocation on every
request. The adapter resolves once per data request and uses that snapshot throughout it.

When `resolveContext` is present, context headers and the tenant query parameter cannot supply
or override the principal. A null result never falls back to them. An exception fails closed
with a generic 500 problem; no internal identity-service message is returned.

Models declaring `multitenancy` require a nonempty `tenantId` for every data route, including
CRUD, named queries, MCP calls and `/screens`. Missing scope answers 403 `TENANT_REQUIRED`
before accessing data. Metadata (`/health`, `/livez`, `/openapi.json`, `/schema.graphql`,
`/api/mcp/tools`), static `/uidl` routes and CORS preflight remain public.

## Header Trust Migration

Context headers are ignored by default. For local Hono development, opt in explicitly:

```ts
const devApp = createKerangkaHonoApp(kir, { trustContextHeaders: true });
```

Only this mode accepts `X-Actor-Id`, comma-separated `X-Actor-Roles`, and `X-Tenant-Id`
(or `?tenantId=` when the tenant header is absent). Do not expose it directly to untrusted
clients. A trusted reverse proxy must strip client-supplied context headers before setting its
own. A supplied resolver always takes precedence over this flag.

The separate Node sidecar behind `kerangka dev` does not use this Hono factory and is not
changed by this slice.

## Tenant And Retry Boundaries

All item lookups pass the verified tenant to the store. A foreign item therefore answers 404,
not the previous 403 obtained by loading the row outside its tenant scope. Read filters still
apply to records returned by the scoped lookup.

Creates inject an omitted tenant discriminator before validation. Client bodies, computed
records, actions and transitions cannot change it to another tenant. The configured
`multitenancy.field` defaults to `tenantId`.

Idempotency entries are namespaced by application and verified context. Identical retries in
one context replay normally; another tenant, actor or changed role cannot reuse that cached
response. Existing raw-key entries are intentionally not replayed. Custom idempotency stores
must treat the adapter's storage key as opaque rather than interpret it as the raw HTTP header.

See [ADR-0047](../../docs/adr/0047-hono-context-is-owned-by-the-host.md) for the security decision.
