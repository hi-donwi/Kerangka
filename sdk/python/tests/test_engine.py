import json
import os
import unittest
from kerangka.engine.engine import ReferenceEngine


class TestPythonEngine(unittest.TestCase):
    def setUp(self):
        self.doc = {
            "kir": "0.1",
            "app": "invoicing",
            "entities": {
                "Invoice": {
                    "key": "number",
                    "fields": {
                        "number": {"type": "string", "required": True},
                        "customer": {"type": "string", "required": True},
                        "status": {
                            "type": "enum",
                            "values": ["draft", "sent", "paid", "void"],
                            "default": "draft"
                        },
                        "total": {
                            "type": "decimal",
                            "compute": {
                                "type": "call",
                                "func": "sum",
                                "args": [
                                    {"type": "ref", "name": "lines"},
                                    {"type": "binary", "op": "*"}
                                ]
                            }
                        }
                    },
                    "workflow": {
                        "field": "status",
                        "transitions": {
                            "send": {
                                "from": "draft",
                                "to": "sent",
                                "roles": ["billing"],
                                "then": [{"emit": "InvoiceSent", "data": {"invoice": "id"}}]
                            },
                            "pay": {
                                "from": "sent",
                                "to": "paid",
                                "roles": ["billing"]
                            }
                        }
                    }
                }
            }
        }
        self.engine = ReferenceEngine(self.doc)

    def test_compute_aggregates(self):
        record = {
            "number": "INV-100",
            "customer": "CUST-1",
            "lines": [
                {"description": "Item A", "qty": 2, "unitPrice": 50},
                {"description": "Item B", "qty": 1, "unitPrice": 100}
            ]
        }
        computed = self.engine.compute("Invoice", record)
        self.assertEqual(computed["total"], 200)
        self.assertEqual(computed["status"], "draft")

    def test_validation(self):
        valid_res = self.engine.validate("Invoice", {"number": "INV-1", "customer": "CUST-1", "status": "draft"})
        self.assertTrue(valid_res.valid)

        invalid_res = self.engine.validate("Invoice", {"number": "INV-1", "customer": "CUST-1", "status": "unknown"})
        self.assertFalse(invalid_res.valid)
        self.assertEqual(invalid_res.errors[0].code, "INVALID_ENUM")

    def test_workflow_transitions(self):
        record = {
            "number": "INV-100",
            "customer": "CUST-1",
            "status": "draft",
            "lines": []
        }
        # 1. Deny transition if actor lacks role
        res_denied = self.engine.transition("Invoice", record, "send", actor={"roles": ["viewer"]})
        self.assertFalse(res_denied.ok)
        self.assertEqual(res_denied.error, "PERMISSION_DENIED")

        # 2. Allow transition with billing role
        res_ok = self.engine.transition("Invoice", record, "send", actor={"roles": ["billing"]})
        self.assertTrue(res_ok.ok)
        self.assertEqual(res_ok.record["status"], "sent")
        self.assertEqual(len(res_ok.events), 1)
        self.assertEqual(res_ok.events[0]["name"], "InvoiceSent")


if __name__ == "__main__":
    unittest.main()


class TestFailClosed(unittest.TestCase):
    """This engine has no expression evaluator yet; a guard it cannot evaluate must refuse the
    transition rather than skip it, or it runs a transition the model forbids (ADR-0008)."""

    def test_a_guarded_transition_is_refused_not_skipped(self):
        doc = {
            "kir": "0.1",
            "app": "guards",
            "entities": {
                "Invoice": {
                    "fields": {"status": {"type": "enum", "values": ["draft", "sent"]}},
                    "workflow": {
                        "field": "status",
                        "transitions": {
                            "send": {"from": "draft", "to": "sent", "when": {"$expr": ">", "args": []}}
                        },
                    },
                }
            },
        }
        result = ReferenceEngine(doc).transition("Invoice", {"status": "draft"}, "send")
        self.assertFalse(result.ok)
        self.assertEqual(result.error, "GUARD_UNSUPPORTED")
