# ADR-0018: Layered State and Action Replay Offline Sync

- **Date:** 2026-09-27
- **Status:** Accepted
- **Deciders:** The Kerangka Authors
- **Project:** kerangka

## Context

Diff-based offline synchronization often leads to subtle data corruption, merge conflicts, and bypassed validation rules.

## Decision

State is strictly layered: UIDL owns UI state; Kerangka client owns data cache and drafts (IndexedDB); server owns true business state. Offline synchronization replays actions on the server with full validation, rather than merging raw data diffs.

## Consequences

### Positive
- Business rules, permissions, and invariants are guaranteed to execute on the server even for offline-created data.

### Negative
- Action replay requires conflict resolution policies (`reject-and-review`, `client-wins`, `server-wins`) when concurrent modifications occur.

### Neutral
- Optimistic updates in the client are rolled back automatically if the server rejects an action.

## Alternatives Considered

| Option | Why rejected |
|---|---|
| CRDT or raw table diff syncing | Bypasses business invariants and validation rules, risking database corruption. |

## Follow-up

- [x] Recorded in PLAN.md §22
- [ ] Conformance test cases written
- [ ] Tier 1 engine implementations verified
