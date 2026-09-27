# Kerangka RFCs (Request for Comments)

Every substantial change to the Kerangka specification, Intermediate Representation (IR), syntax, or engine semantics starts as a public RFC.

## RFC Lifecycle

```
Draft → In Review (min. 14 days) → Accepted / Rejected → Implemented (in Spec & Conformance)
```

1. **Draft:** The author copies `0000-template.md` to `rfcs/YYYYMMDD-short-title.md` and opens a PR.
2. **Review:** The community and maintainers discuss the proposal, test edge cases, and evaluate the concept budget impact.
3. **Decision:**
   - **Accepted:** Assigned an official RFC number, merged to `main`, and turned into an ADR in `docs/adr/`.
   - **Rejected:** Documented with rationale and closed.
4. **Implementation:** Merged into `spec/`, conformance test cases added, and implemented across Tier 1 engines.

## Active and Accepted RFCs

| RFC | Title | Author | Status | Target Phase |
|---|---|---|---|---|
| [RFC-0000](0000-template.md) | RFC Process and Template | The Kerangka Authors | Active | Phase 0 |
