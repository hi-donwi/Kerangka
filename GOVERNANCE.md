# Governance and the Path to a Standard

## 1. Principles

Kerangka is designed to become an **open standard for describing software**. To be trusted by developers, companies, and the global open-source ecosystem, its governance follows these foundational principles:

- **Open Specification:** The specification text is licensed under Creative Commons Attribution 4.0 (CC BY 4.0). Anyone may implement, translate, or republish it.
- **Explicit Patent Grant:** Implementation code and Tier 1 SDKs are licensed under Apache-2.0, providing explicit patent grants to adopters and implementers.
- **Public RFC Process:** No architectural or semantic changes enter the specification without an open, public Request for Comments (RFC) in `rfcs/`.
- **Concept Budget:** To prevent the inner-platform effect, the entire language is constrained by a strict budget of 25 core concepts. A new feature must replace an existing one or prove indispensable.
- **Identical Behavior Everywhere:** Certification is based solely on passing 100% of the active conformance test suite.

## 2. Four Stages to a Neutral Standard

Kerangka follows a four-stage path from maintainer-led development to an internationally governed standard:

| Stage | Milestone | Trigger |
|---|---|---|
| **Stage 1: Open Specification** | Public spec, public RFC process, 32 ADRs, conformance test harness, TypeScript reference implementation. | From Phase 0 |
| **Stage 2: Multiple Implementations** | 5 Tier 1 native engines (TS, Java, Python, Dart, Go), at least 2 independent engines or 5 adapters built outside the core team, certified by the conformance kit. | v1.0, Horizon 2 |
| **Stage 3: Shared Stewardship** | A formal Steering Committee with members from at least three independent organizations; published governance charter and trademark guidelines. | Horizon 2 |
| **Stage 4: Neutral Home** | Formal submission to an established open-source foundation (such as the Linux Foundation or OpenJS Foundation). | Horizon 3 (v2.0) |

## 3. RFC Process

All modifications to the specification, Intermediate Representation (IR), or core semantics must follow the RFC process:

1. **Proposal:** Create `rfcs/NNNN-title.md` using the template in `rfcs/0000-template.md`.
2. **Review Period:** An open comment period of at least 14 days on GitHub Discussions and Pull Requests.
3. **Consensus:** A proposal is accepted when consensus is reached among maintainers and steering members, with particular scrutiny on:
   - Impact on conformance tests across all 5 Tier 1 languages.
   - Impact on the 25-concept budget.
   - Backward and forward compatibility (Expand/Contract rules).
4. **Adoption:** Accepted RFCs become committed ADRs in `docs/adr/` and are incorporated into the specification.

## 4. Current Stewardship: Single Maintainer to Open Community

During Stage 1 (Foundations and v0.x), Kerangka is stewarded by its founder/lead maintainer as a single contributor driving the specification, compiler, and reference implementations.
- Decisions are made directly by the lead maintainer while strictly adhering to public RFCs, ADR documentation, and the 25-concept budget.
- As adoption grows toward v1.0 and enters Stage 2 and Stage 3, governance expands to include external contributors, certified engine/adapter maintainers, and a formal multi-organization steering committee.

## 5. Trademark and Compatibility

The "Kerangka" name and the "Kerangka Compatible" badge represent quality and behavioral uniformity. An engine, compiler, or adapter may display the "Kerangka Compatible" badge only when it produces a published, reproducible run demonstrating 100% passing conformance against the active test suite.
