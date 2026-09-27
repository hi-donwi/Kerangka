# Security Policy

## Supported Versions

Kerangka takes security seriously across its specification, compiler, and language engine runtimes.

| Version | Supported |
|---|---|
| 0.1.x | Yes |
| < 0.1 | No |

## Reporting a Vulnerability

If you discover a security vulnerability in Kerangka, **please do not open a public issue.**
Instead, report it responsibly via one of the following channels:

1. **GitHub Security Advisories:** Use the "Report a vulnerability" button on the [GitHub repository](https://github.com/hi-donwi/Kerangka/security/advisories).
2. **Email:** Send details to `security@donwi.com` (or the maintainer address listed in `GOVERNANCE.md`).

Please include:
- A description of the issue and potential impact.
- Steps to reproduce or a minimal proof-of-concept `.kerangka.json` or IR file.
- Any affected engine runtimes (TypeScript, Java, Python, Dart, Go).

You will receive an acknowledgment within 48 hours, followed by a remediation plan and timeline.

## Security Model and Boundaries

Kerangka is designed under the assumption that **every `.kerangka.json` document may be untrusted** (authored by third parties, tenants, or AI agents). The engine and compiler enforce the following non-negotiable boundaries:

1. **No Arbitrary Code Execution:** The core engine is a pure library without eval, dynamic imports, or access to system processes.
2. **Termination Guarantee:** The expression language is not Turing-complete. Recursion is prohibited, expression depth is capped at 64, and list aggregations are strictly bounded.
3. **Tenant Isolation:** Multi-tenant documents automatically push tenant filters to storage adapters. Cross-tenant cache keys and queries are blocked by construction.
4. **SSRF Protection in Connectors:** The HTTP connector blocks private network ranges (RFC 1918, link-local, loopback) by default, requiring explicit host allowlists.
5. **Secret Protection:** Secrets are never written to documents. They are referenced via `${secret:KEY}` and injected by host adapters at runtime.
6. **Personal Data Masking:** Fields declared with `"personal": true` are masked in logs, traces, and error messages to prevent accidental privacy leakage.
