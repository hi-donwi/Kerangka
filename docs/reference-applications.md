# Reference Application Catalogue

Kerangka evaluates its expressive power and concept economy against ten concrete, real-world business domains. Each reference domain must be fully expressible in Kerangka JSON/YAML with zero host code.

| # | Domain | Core Capabilities Demonstrated | Target Profile |
|---|---|---|---|
| 1 | **Invoicing & Billing** | Exact decimal arithmetic, embedded lines, workflow transitions (`send`, `pay`, `void`), payment receipts | Starter |
| 2 | **HR Leave Requests** | Decision table approver routing, human tasks, generated inbox, SLA escalation timers | Starter |
| 3 | **Warehouse Inventory** | Aggregate-level invariants (`quantity >= reserved`), stock movements, discriminator multi-tenancy | Starter |
| 4 | **Appointment Booking** | Time-slot reservation, recurring schedules, capacity limits, conflict detection | Standard |
| 5 | **B2B SaaS Subscriptions** | Tenant isolation, usage metering, recurring invoice generation, tenant overlays | Standard |
| 6 | **Helpdesk & Ticket SLA** | Multi-tier support queues, customer portal permissions, automated SLA breach escalation | Standard |
| 7 | **Purchase Order Approval** | Multi-level managerial approval hierarchies, department budget verification rules | Standard |
| 8 | **Retail Point of Sale (POS)** | Offline action replay, optimistic stock deduction, cash drawer audit logging | Standard |
| 9 | **Course Enrollment** | Prerequisite course rules, enrollment capacity caps, student grading workflows | Distributed |
| 10 | **Clinic & E-Prescriptions** | Personal data masking (UU PDP / GDPR compliance), appointment queues, doctor prescription workflows | Distributed |

## Criteria for Inclusion

Every reference application must:
1. Include at least two interconnected entities or an aggregate with embedded records.
2. Define at least one non-trivial business rule, workflow, or decision table.
3. Be runnable locally via `kerangka dev <file>` with zero configuration.
4. Pass automated conformance tests and static analysis (`kerangka verify`).
