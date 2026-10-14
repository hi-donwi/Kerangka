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


def _guarded(when):
    return {
        "kir": "0.1",
        "app": "guards",
        "entities": {
            "Invoice": {
                "fields": {"status": {"type": "enum", "values": ["draft", "sent"]}},
                "workflow": {
                    "field": "status",
                    "transitions": {"send": {"from": "draft", "to": "sent", "when": when}},
                },
            }
        },
    }


class TestFailClosed(unittest.TestCase):
    """A guard this subset cannot evaluate must refuse the transition rather than skip it
    (ADR-0008). A comparison it can evaluate must be true before the transition runs."""

    def test_an_unsupported_guard_is_refused_not_skipped(self):
        result = ReferenceEngine(_guarded({"$expr": "today", "args": []})).transition(
            "Invoice", {"status": "draft"}, "send"
        )
        self.assertFalse(result.ok)
        self.assertEqual(result.error, "GUARD_UNSUPPORTED")

    def test_a_true_comparison_guard_allows_the_transition(self):
        when = {"$expr": "==", "args": [{"$bind": "status"}, {"literal": "draft"}]}
        result = ReferenceEngine(_guarded(when)).transition("Invoice", {"status": "draft"}, "send")
        self.assertTrue(result.ok)
        self.assertEqual(result.record["status"], "sent")

    def test_a_conjunction_guard_allows_the_transition(self):
        when = {
            "$expr": "&&",
            "args": [
                {"$expr": "==", "args": [{"$bind": "status"}, {"literal": "draft"}]},
                {"$expr": "!=", "args": [{"$bind": "status"}, {"literal": "sent"}]},
            ],
        }
        result = ReferenceEngine(_guarded(when)).transition("Invoice", {"status": "draft"}, "send")
        self.assertTrue(result.ok)

    def test_a_false_comparison_guard_does_not_run_the_transition(self):
        when = {"$expr": "==", "args": [{"$bind": "status"}, {"literal": "sent"}]}
        result = ReferenceEngine(_guarded(when)).transition("Invoice", {"status": "draft"}, "send")
        self.assertFalse(result.ok)
        self.assertEqual(result.error, "GUARD_FAILED")


class TestPermissionsAndCanOperate(unittest.TestCase):
    def setUp(self):
        doc = {
            "kir": "0.1",
            "app": "perms-test",
            "entities": {
                "Invoice": {
                    "fields": {
                        "status": {"type": "enum", "values": ["draft", "sent"]},
                        "ownerId": {"type": "string"},
                        "total": {"type": "decimal"},
                    },
                    "permissions": {
                        "read": ["admin", "billing", "viewer"],
                        "create": ["admin", "billing"],
                        "update": {
                            "admin": True,
                            "billing": "status == 'draft'",
                            "owner": "ownerId == actor.id",
                            "viewer": False,
                        },
                        "delete": [],
                    },
                },
                "PublicDoc": {
                    "fields": {"id": {"type": "string"}},
                },
            },
        }
        self.engine = ReferenceEngine(doc)
        self.admin = {"id": "u-admin", "roles": ["admin"]}
        self.billing = {"id": "u-billing", "roles": ["billing"]}
        self.viewer = {"id": "u-viewer", "roles": ["viewer"]}
        self.owner = {"id": "u-owner-1", "roles": ["owner"]}

    def test_unlisted_operation_is_open(self):
        dec = self.engine.can_operate("Invoice", "archive", self.viewer)
        self.assertTrue(dec.allowed)

    def test_empty_list_grants_no_one(self):
        dec = self.engine.can_operate("Invoice", "delete", self.admin)
        self.assertFalse(dec.allowed)
        self.assertEqual(dec.code, "PERMISSION_DENIED")

    def test_unknown_entity_refused(self):
        dec = self.engine.can_operate("Unknown", "read", self.admin)
        self.assertFalse(dec.allowed)
        self.assertEqual(dec.code, "UNKNOWN_ENTITY")

    def test_role_mapped_to_true_allows(self):
        dec = self.engine.can_operate("Invoice", "update", self.admin)
        self.assertTrue(dec.allowed)
        dec_rec = self.engine.can_operate("Invoice", "update", self.admin, {"status": "sent"})
        self.assertTrue(dec_rec.allowed)

    def test_role_mapped_to_false_refused(self):
        dec = self.engine.can_operate("Invoice", "update", self.viewer, {"status": "draft"})
        self.assertFalse(dec.allowed)
        self.assertEqual(dec.code, "PERMISSION_DENIED")

    def test_conditional_grant_without_record_returns_needs_record(self):
        dec = self.engine.can_operate("Invoice", "update", self.billing)
        self.assertFalse(dec.allowed)
        self.assertEqual(dec.code, "PERMISSION_NEEDS_RECORD")

    def test_conditional_grant_with_matching_record(self):
        dec = self.engine.can_operate("Invoice", "update", self.billing, {"status": "draft"})
        self.assertTrue(dec.allowed)

    def test_conditional_grant_with_non_matching_record(self):
        dec = self.engine.can_operate("Invoice", "update", self.billing, {"status": "sent"})
        self.assertFalse(dec.allowed)
        self.assertEqual(dec.code, "PERMISSION_DENIED")

    def test_actor_context_matching_in_condition(self):
        dec = self.engine.can_operate("Invoice", "update", self.owner, {"status": "sent", "ownerId": "u-owner-1"})
        self.assertTrue(dec.allowed)
        dec_other = self.engine.can_operate("Invoice", "update", self.owner, {"status": "sent", "ownerId": "u-other"})
        self.assertFalse(dec_other.allowed)
        self.assertEqual(dec_other.code, "PERMISSION_DENIED")


class TestAuthorizeReadAndReadFilter(unittest.TestCase):
    def setUp(self):
        doc = {
            "kir": "0.1",
            "app": "rf-test",
            "entities": {
                "Public": {
                    "fields": {"id": {"type": "string"}},
                },
                "Scoped": {
                    "fields": {"tenantId": {"type": "string"}},
                },
                "SoftDeleted": {
                    "fields": {"deleted": {"type": "boolean"}},
                },
                "Doc": {
                    "fields": {"tenantId": {"type": "string"}},
                    "readFilter": ["==", ["get", "ownerId"], ["actor", "id"]],
                },
                "BrokenDoc": {
                    "fields": {"tenantId": {"type": "string"}},
                    "readFilter": "status == 'draft'",
                },
            },
        }
        self.engine = ReferenceEngine(doc)
        self.admin_tenant = {"id": "u-1", "tenantId": "tenant-a", "roles": ["admin"]}
        self.admin_no_tenant = {"id": "u-1", "roles": ["admin"]}

    def test_public_entity(self):
        scope = self.engine.authorize_read("Public")
        self.assertTrue(scope.allowed)
        self.assertIsNone(scope.where)

    def test_unknown_entity_refused(self):
        scope = self.engine.authorize_read("Unknown")
        self.assertFalse(scope.allowed)
        self.assertEqual(scope.code, "UNKNOWN_ENTITY")

    def test_scoped_without_tenant_denied(self):
        scope = self.engine.authorize_read("Scoped", self.admin_no_tenant)
        self.assertFalse(scope.allowed)
        self.assertEqual(scope.code, "PERMISSION_DENIED")

    def test_scoped_with_tenant_allowed(self):
        scope = self.engine.authorize_read("Scoped", self.admin_tenant)
        self.assertTrue(scope.allowed)
        self.assertEqual(scope.where, ["==", ["get", "tenantId"], "tenant-a"])

    def test_soft_deleted_adds_condition(self):
        scope = self.engine.authorize_read("SoftDeleted")
        self.assertTrue(scope.allowed)
        self.assertEqual(scope.where, ["==", ["get", "deleted"], False])

    def test_uncompiled_string_read_filter_refused(self):
        scope = self.engine.authorize_read("BrokenDoc", self.admin_tenant)
        self.assertFalse(scope.allowed)
        self.assertEqual(scope.code, "READ_FILTER_NOT_COMPILED")

    def test_combined_read_filter_and_eval(self):
        scope = self.engine.authorize_read("Doc", self.admin_tenant)
        self.assertTrue(scope.allowed)
        self.assertEqual(scope.where[0], "and")

        # Test eval_filter
        self.assertTrue(self.engine.eval_filter(scope.where, {"tenantId": "tenant-a", "ownerId": "u-1"}, self.admin_tenant))
        self.assertFalse(self.engine.eval_filter(scope.where, {"tenantId": "tenant-b", "ownerId": "u-1"}, self.admin_tenant))
        self.assertFalse(self.engine.eval_filter(scope.where, {"tenantId": "tenant-a", "ownerId": "u-2"}, self.admin_tenant))

