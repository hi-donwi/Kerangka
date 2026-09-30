#!/usr/bin/env python3
"""
Phase 2 exit gate: a non-JavaScript client drives the invoicing workflow.

PLAN.md section 19 asks for exactly this. The script starts `kerangka serve --stdio`, drives
a draft invoice through send and pay, and asserts what came back. Any refusal, protocol
error, or unexpected record exits non-zero, so CI can run it without a Python test runner.

    python3 scripts/sidecar-smoke.py [document]
"""

from __future__ import annotations

import os
import sys

sys.path.insert(
    0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "sdk", "python", "src")
)

from kerangka.sidecar import Sidecar, SidecarError  # noqa: E402

DOCUMENT = sys.argv[1] if len(sys.argv) > 1 else "examples/invoicing.kerangka.json"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BILLING = {"id": "u-1", "roles": ["billing"]}
VIEWER = {"id": "u-2", "roles": ["viewer"]}

failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    status = "ok  " if condition else "FAIL"
    print(f"[{status}] {label}{f' — {detail}' if detail else ''}")
    if not condition:
        failures.append(label)


def main() -> int:
    print(f"sidecar client (python) driving {DOCUMENT}\n")

    with Sidecar(DOCUMENT, cwd=ROOT) as kerangka:
        described = kerangka.describe()
        check("describe returns the invoicing model", "Invoice" in described.get("entities", []),
              f"entities={described.get('entities')}")

        draft = {
            "id": "inv-py-1",
            "number": "INV-PY-1",
            "customer": "cust-1",
            "issuedOn": "2026-09-01",
            "dueDate": "2026-10-01",
            "status": "draft",
            "lines": [{"description": "Consulting", "qty": 2, "unitPrice": 150}],
        }

        validation = kerangka.validate("Invoice", draft)
        check("draft invoice is valid", bool(validation.get("valid")),
              f"errors={validation.get('errors')}")

        computed = kerangka.compute("Invoice", draft)
        check("total is computed from the lines", computed.get("total") == 300,
              f"total={computed.get('total')}")

        available = kerangka.available("Invoice", draft, BILLING)
        names = sorted(op.get("name", "") for op in available)
        check("billing may send the invoice", "send" in names, f"available={names}")

        sent = kerangka.run("Invoice.send", draft, actor=BILLING)
        check("send succeeds", bool(sent.get("ok")), f"code={sent.get('code')}")
        check("status is sent", (sent.get("record") or {}).get("status") == "sent",
              f"status={(sent.get('record') or {}).get('status')}")
        check("the transition emits its event",
              any(e.get("type") == "InvoiceSent" for e in sent.get("events", [])),
              f"events={[e.get('type') for e in sent.get('events', [])]}")

        # Persistence: the sidecar applied the persist effect, so the aggregate is now
        # readable without the client having sent it back.
        stored = kerangka.get("Invoice", "inv-py-1")
        check("the sidecar stored the sent invoice",
              (stored or {}).get("status") == "sent",
              f"stored={stored}")
        check("the computed total survived the round trip",
              (stored or {}).get("total") == 300,
              f"total={(stored or {}).get('total')}")
        check("the session logged the emitted event",
              any(e.get("type") == "InvoiceSent" for e in kerangka.events("InvoiceSent")))

        forbidden = kerangka.run("Invoice.send", draft, actor=VIEWER)
        check("a viewer is refused", forbidden.get("ok") is False and forbidden.get("code"),
              f"code={forbidden.get('code')}")
        check("a refused run stores nothing new",
              len(kerangka.list("Invoice")) == 1,
              f"stored={len(kerangka.list('Invoice'))}")

        # Run against the stored aggregate by id alone: the sidecar supplies the record.
        paid = kerangka.run("Invoice.pay", {"id": "inv-py-1"}, actor=BILLING)
        check("pay succeeds on the stored invoice", bool(paid.get("ok")), f"code={paid.get('code')}")
        check("status is paid", (paid.get("record") or {}).get("status") == "paid",
              f"status={(paid.get('record') or {}).get('status')}")
        check("the store agrees", (kerangka.get("Invoice", "inv-py-1") or {}).get("status") == "paid")
        check("an id the session never saw reads as null",
              kerangka.get("Invoice", "inv-py-never") is None)

        # A created aggregate is addressable, so the host can read it back. The policy
        # ids exist for the same reason: the store addresses by id or not at all.
        check("claims start empty", kerangka.claims() == [], f"claims={kerangka.claims()}")

        try:
            kerangka.call("teleport")
            check("an unknown method raises", False, "no error raised")
        except SidecarError as err:
            check("an unknown method raises", err.code == -32601, f"code={err.code}")

    drive_policies()

    print()
    if failures:
        print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
        return 1
    print("all checks passed")
    return 0


def drive_policies() -> None:
    """Cross-context policies, driven by the same Python client.

    `handle` is the host loop PLAN.md 7.4 leaves to the host: react, run what the
    policies chose, apply the effects. A replayed event must not act twice.
    """
    print("\npolicy handling across contexts (commerce)\n")

    with Sidecar("examples/commerce/kerangka.json", cwd=ROOT) as commerce:
        placed = commerce.run(
            "Order.place",
            {
                "id": "o-py-1",
                "orderNumber": "ORD-PY-1",
                "customerId": "c-1",
                "status": "draft",
                "lines": [{"qty": 2, "price": 100}],
            },
            actor={"id": "c-1", "roles": ["customer"]},
        )
        check("the order is placed", bool(placed.get("ok")), f"code={placed.get('code')}")
        event = (placed.get("events") or [{}])[0]
        check("it emitted OrderPlaced", event.get("type") == "OrderPlaced",
              f"type={event.get('type')}")

        system = {"id": "policy-runner", "roles": ["system"]}
        handled = commerce.handle(event, actor=system)
        actions = sorted(r["action"] for r in handled.get("runs", []))
        check("both contexts' policies ran", actions == ["Invoice.create", "StockReservation.create"],
              f"actions={actions}")

        invoices = commerce.list("Invoice")
        check("the billing context stored an invoice", len(invoices) == 1, f"count={len(invoices)}")
        reservations = commerce.list("StockReservation")
        check("the inventory context stored a reservation", len(reservations) == 1,
              f"count={len(reservations)}")

        stored_id = (invoices[0] or {}).get("id")
        fetched = commerce.get("Invoice", stored_id) if stored_id else None
        check("the created aggregate is addressable by id",
              (fetched or {}).get("invoiceNumber") == "INV-o-py-1",
              f"invoiceNumber={(fetched or {}).get('invoiceNumber')}")

        replayed = commerce.handle(event, actor=system)
        check("a replayed event runs nothing", replayed.get("runs") == [],
              f"runs={replayed.get('runs')}")
        check("both policies were skipped as already claimed",
              len(replayed.get("skipped", [])) == 2, f"skipped={replayed.get('skipped')}")
        check("the replay stored nothing new", len(commerce.list("Invoice")) == 1)
        check("the claims are visible", len(commerce.claims()) == 2, f"claims={commerce.claims()}")


if __name__ == "__main__":
    raise SystemExit(main())
