import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  AddressType,
  AuditableTrait,
  instantiateTemplate,
  KerangkaRecommendedPreset,
  MoneyType,
  PeriodType,
  SoftDeleteTrait,
  STD_PACKAGE,
  TenantScopedTrait,
} from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

  it("instantiates the approval workflow in the shape a model document writes it", () => {
    const approval = STD_PACKAGE.templates?.approval;
    expect(approval).toBeDefined();
    if (!approval) return;

    const instantiated = instantiateTemplate<{
      transitions: Record<string, { roles: string[] }>;
      initial: string;
    }>(approval, { submitter: "employee", approver: "manager" });

    expect(instantiated.initial).toBe("draft");
    expect(instantiated.transitions.submit?.roles).toEqual(["employee"]);
    expect(instantiated.transitions.approve?.roles).toEqual(["manager"]);
    expect(instantiated.transitions.reject?.roles).toEqual(["manager"]);
    // The description of the template is not part of what it expands to.
    expect(instantiated).not.toHaveProperty("template");
    expect(instantiated).not.toHaveProperty("params");
  });

  it("instantiates the masterDetail view with the keys the UIDL projector reads", () => {
    const masterDetail = STD_PACKAGE.templates?.masterDetail;
    expect(masterDetail).toBeDefined();
    if (!masterDetail) return;

    const instantiated = instantiateTemplate(masterDetail, {
      entity: "Invoice",
      columns: ["number", "total"],
    });

    expect(instantiated).toEqual({ list: "Invoice", columns: ["number", "total"] });
  });

  it("refuses arguments that do not fit, naming every problem", () => {
    const approval = STD_PACKAGE.templates?.approval;
    if (!approval) throw new Error("approval missing");
    expect(() => instantiateTemplate(approval, { submitter: "employee", aprover: "manager" })).toThrow(
      /TEMPLATE_PARAM_UNKNOWN[\s\S]*TEMPLATE_PARAM_MISSING/
    );
  });

  it("ships a kerangka.json manifest identical to STD_PACKAGE", () => {
    // The manifest is what a package reader sees; STD_PACKAGE is what the compiler resolves.
    // Two descriptions of one package drift unless something compares them.
    const manifestPath = path.resolve(__dirname, "../kerangka.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    expect(manifest).toEqual(JSON.parse(JSON.stringify(STD_PACKAGE)));
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
