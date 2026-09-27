# Contributing to Kerangka

Thank you for your interest in contributing to Kerangka! Kerangka is building an open standard and multi-language SDK family for software logic and UI.

## Code of Conduct

We are committed to providing a friendly, safe, and welcoming environment for everyone, regardless of background, identity, or experience level. Be respectful, constructive, and open to feedback.

## How Can You Contribute?

1. **RFCs (Proposing Features or Spec Changes):**
   - Check existing discussions and RFCs in `rfcs/`.
   - Copy `rfcs/0000-template.md` to a new branch, fill in your proposal, and submit a PR for public review.
2. **Conformance Cases (Data-driven Tests):**
   - Kerangka's conformance suite is data, not code. Adding new edge cases in `conformance/` helps ensure identical semantics across TypeScript, Java, Python, Dart, and Go.
3. **Engines and Adapters:**
   - Implement storage, bus, cache, or connector adapters against our published port test kits.
4. **Documentation & Learning:**
   - Improve guides, fix typos, translate exercises in `learn/`, or author reference application examples.

## Ground Rules

- **English:** Every tracked file, specification document, code comment, and commit message must be in English.
- **Conventional Commits:** Use structured commit messages: `feat:`, `fix:`, `docs:`, `spec:`, `test:`, `refactor:`, `chore:`.
- **Tests First:** Any behavioral change or bug fix must include a reproducing conformance case or unit test that fails without the change.
- **Concept Budget:** We strictly limit the specification to 25 core concepts. Propose new features with caution and explain their concept-budget impact.
- **No Credentials:** Never commit credentials, private keys, or private client identifiers.

## Development Workflow

1. Fork the repository and create your feature branch:
   ```bash
   git checkout -b feat/my-improvement
   ```
2. Ensure linting and conformance tests pass:
   ```bash
   npm run check
   npm test
   ```
3. Commit your changes adhering to Conventional Commits:
   ```bash
   git commit -m "feat(spec): add support for range constraints on decimals"
   ```
4. Push to your fork and submit a Pull Request. Maintainers will review and assist you!
