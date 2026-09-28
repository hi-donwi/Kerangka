import { describe, expect, it } from "vitest";
import {
  AddressType,
  AuditableTrait,
  instantiateTemplate,
  KerangkaRecommendedPreset,
  MoneyType,
  PeriodType,
  SoftDeleteTrait,
  STD_PACKAGE,
  StdWorkflowTemplate,
  TenantScopedTrait,
} from "../src/index.js";

describe("@kerangka/std", () => {
  it("provides standard value types", () => {
    expect(MoneyType.type).toBe("Money");
    expect(MoneyType.fields.amount).toBe("decimal(12,2)!");
    expect(MoneyType.fields.currency).toContain("USD");
    expect(MoneyType.rules).toContain("length(currency) == 3");

    expect(AddressType.type).toBe("Address");
    expect(AddressType.fields.street).toBe("string!");
    expect(AddressType.fields.city).toBe("string!");
    expect(AddressType.fields.postalCode).toBe("string!");

    expect(PeriodType.type).toBe("Period");
    expect(PeriodType.fields.startDate).toBe("date!");
    expect(PeriodType.fields.endDate).toBe("date!");
    expect(PeriodType.rules).toContain("endDate >= startDate");
  });

  it("provides standard traits with defaults and readFilters", () => {
    expect(AuditableTrait.trait).toBe("auditable");
    expect(AuditableTrait.fields.createdAt).toBeDefined();
    expect(AuditableTrait.fields.createdBy).toBeDefined();
    expect(AuditableTrait.defaults?.createdAt).toBe("now()");

    expect(SoftDeleteTrait.trait).toBe("softDelete");
    expect(SoftDeleteTrait.readFilter).toBe("deletedAt == null");

    expect(TenantScopedTrait.trait).toBe("tenantScoped");
    expect(TenantScopedTrait.defaults?.tenantId).toBe("actor.tenantId");
    expect(TenantScopedTrait.readFilter).toBe("tenantId == actor.tenantId");
  });

  it("instantiates workflow templates without code or loops", () => {
    const approval = STD_PACKAGE.templates?.approval;
    expect(approval).toBeDefined();
    if (!approval) return;

    const instantiated = instantiateTemplate<StdWorkflowTemplate>(approval, {
      submitter: "employee",
      approver: "manager",
    });

    expect(instantiated.transitions[0]?.roles).toEqual(["employee"]);
    expect(instantiated.transitions[1]?.roles).toEqual(["manager"]);
    expect(instantiated.transitions[2]?.roles).toEqual(["manager"]);
  });

  it("instantiates view templates with parameters", () => {
    const masterDetail = STD_PACKAGE.templates?.masterDetail;
    expect(masterDetail).toBeDefined();
    if (!masterDetail) return;

    const instantiated = instantiateTemplate(masterDetail, {
      entity: "Invoice",
      title: "Invoice Overview",
    }) as any;

    expect(instantiated.master.entity).toBe("Invoice");
    expect(instantiated.master.title).toBe("Invoice Overview");
    expect(instantiated.detail.entity).toBe("Invoice");
  });

  it("provides recommended lint preset", () => {
    expect(KerangkaRecommendedPreset.budgets.linesPerFile).toBe(300);
    expect(KerangkaRecommendedPreset.naming.aggregate).toBe("pascal");
    expect(KerangkaRecommendedPreset.naming.field).toBe("camel");
    expect(KerangkaRecommendedPreset.unused.exports).toBe(true);
  });

  it("matches package manifest exported properties", () => {
    expect(STD_PACKAGE.package).toBe("@kerangka/std");
    expect(STD_PACKAGE.version).toBe("0.1.0");
    expect(Object.keys(STD_PACKAGE.types ?? {})).toEqual(["Money", "Address", "Period"]);
    expect(Object.keys(STD_PACKAGE.traits ?? {})).toEqual(["auditable", "softDelete", "tenantScoped"]);
    expect(Object.keys(STD_PACKAGE.templates ?? {})).toEqual(["approval", "masterDetail"]);
    expect(STD_PACKAGE.presets?.["kerangka:recommended"]).toBeDefined();
  });
});
