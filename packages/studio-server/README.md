# Studio Read-Only Host

`startStudio({ target, port?, prefix? })` opens one operator-selected model file or
directory and binds only to `127.0.0.1`. The returned bootstrap URL carries a random
process capability in its fragment. Treat it as a local operator channel, not an
operational log, shared URL, or browser-storage value. Never send it to preview.

The protected `GET /studio/api/project` requires `Authorization: Bearer <capability>`.
Host/Origin/fetch-metadata checks are independent of that capability; untrusted headers
cannot change the selected project. All write methods are refused. No business API,
identity resolver, store, connector, or source-save operation is exposed.

Discovery includes the selected entry, canonical `kerangka.json/yaml/yml`,
`*.kerangka.json/yaml/yml`, `*.uidl.json`, and root `kerangka.lock`. Hidden, generated,
dependency, nested repository, and other non-source entries are counted as excluded, not interpreted.
Unrepresentable source paths, symlinks/hardlinks, invalid UTF-8, changing files, and
budget excess fail closed. Text is read from bounded descriptors without normalization.
Enumeration is capped at 10000 entries and depth 16, including non-source entries.

This boundary does not defend against compromise of the local OS/account. Opening a
project deliberately authorizes source reading within its selected canonical root.
The capability is not business-user authentication or proof of tenant isolation.

P1 also serves trusted built Studio assets and bounded inspection/projection jobs.
Public module assets permit opaque-frame CORS; the private source API does not.
See [the full read-only boundary](../../docs/studio/read-only.md) before expanding it.

```sh
npm run build
npm test -- packages/studio-server/test
npm run typecheck
npm run test:studio:e2e
```
