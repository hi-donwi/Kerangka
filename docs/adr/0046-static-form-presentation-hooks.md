# ADR-0046: Static Form Presentation Hooks and Section Titles

- **Status:** Accepted
- **Date:** 2026-10-15

## Context

Static form projection flattened headings and fields into an unstyled Form. JSON
conformance did not detect touching controls or excessively wide input fields.
ADR-0043 assigns presentation to UIDL Runtime and ADR-0045 retains separate static
and per-request host contracts.

## Decision

Group each static form section with existing Column/Text widgets. Emit bounded
form and spacing utilities as structural fallbacks, and the runtime-owned
uidl-admin-* CSS hooks for typography, responsive actions, and shared geometry.
Keep record queries, ids, bindings, commands, routes, and permission seams unchanged.
No new runtime dependency or widget type is required.

Add optional sectionTitles metadata parallel to the existing sections array. The
compiler rejects missing/empty/duplicate titles and normalized heading-id clashes.
Both static and per-request projections preserve the declared labels. Existing
models keep their numbered fallback titles.

## Alternatives

- Replacing static forms with per-request recipes would alter the host contract.
- Copying a stylesheet into the compiler would violate presentation ownership.
- Adding a new Section widget is unnecessary when registered containers suffice.

## Consequences

Consumers need the matching upgraded UIDL stylesheet for complete presentation;
older stylesheets retain the explicit structural layout. Pixel geometry is not
added to model semantics. Section title metadata is additive and older compilers
must be upgraded before accepting it.
