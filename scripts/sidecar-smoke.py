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

        forbidden = kerangka.run("Invoice.send", draft, actor=VIEWER)
        check("a viewer is refused", forbidden.get("ok") is False and forbidden.get("code"),
              f"code={forbidden.get('code')}")

        paid = kerangka.run("Invoice.pay", sent["record"], actor=BILLING)
        check("pay succeeds on the sent invoice", bool(paid.get("ok")), f"code={paid.get('code')}")
        check("status is paid", (paid.get("record") or {}).get("status") == "paid",
              f"status={(paid.get('record') or {}).get('status')}")

        try:
            kerangka.call("teleport")
            check("an unknown method raises", False, "no error raised")
        except SidecarError as err:
            check("an unknown method raises", err.code == -32601, f"code={err.code}")

    print()
    if failures:
        print(f"{len(failures)} check(s) failed: {', '.join(failures)}")
        return 1
    print("all checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
