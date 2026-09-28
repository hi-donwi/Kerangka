import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  compile,
  CompilerError,
  generateLockfile,
  PackageResolver,
  readLockfile,
  verifyLockfile,
  writeLockfile,
} from "../src/index.js";

describe("Package Resolution & kerangka.lock", () => {
  it("resolves built-in @kerangka/std by default", () => {
    const resolver = new PackageResolver({
      kerangka: "0.1",
      app: "test-app",
    });

    const result = resolver.resolve();
    expect(result.diagnostics).toHaveLength(0);
    expect(result.packages["@kerangka/std"]).toBeDefined();
    expect(result.types["Money"]).toBeDefined();
    expect(result.types["std:Money"]).toBeDefined();
    expect(result.traits["auditable"]).toBeDefined();
    expect(result.traits["std:auditable"]).toBeDefined();
    expect(result.templates["approval"]).toBeDefined();
    expect(result.presets["kerangka:recommended"]).toBeDefined();
  });

  it("generates and verifies canonical kerangka.lock", () => {
    const resolver = new PackageResolver({
      kerangka: "0.1",
      app: "test-app",
    });
    const resolution = resolver.resolve();
    const lock = generateLockfile(resolution);

    expect(lock.lockfileVersion).toBe(1);
    expect(lock.packages["@kerangka/std"]).toBeDefined();
    expect(lock.packages["@kerangka/std"]?.version).toBe("0.1.0");
    expect(lock.packages["@kerangka/std"]?.integrity).toMatch(/^sha256-/);
    expect(lock.packages["@kerangka/std"]?.types).toContain("Money");
    expect(lock.packages["@kerangka/std"]?.traits).toContain("auditable");

    const check = verifyLockfile(lock, resolution);
    expect(check.valid).toBe(true);
    expect(check.diagnostics).toHaveLength(0);
  });

  it("detects integrity mismatch in kerangka.lock", () => {
    const resolver = new PackageResolver({
      kerangka: "0.1",
      app: "test-app",
    });
    const resolution = resolver.resolve();
    const lock = generateLockfile(resolution);

    // Tamper with integrity
    lock.packages["@kerangka/std"]!.integrity = "sha256-corrupted";
    const check = verifyLockfile(lock, resolution);
    expect(check.valid).toBe(false);
    expect(check.diagnostics[0]?.code).toBe("LOCKFILE_INTEGRITY_MISMATCH");
  });

  it("writes and reads lockfile to disk", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kerangka-lock-test-"));
    const lockPath = path.join(tmpDir, "kerangka.lock");

    const resolver = new PackageResolver({ kerangka: "0.1", app: "test-app" });
    const lock = generateLockfile(resolver.resolve());

    writeLockfile(lockPath, lock);
    expect(fs.existsSync(lockPath)).toBe(true);

    const loaded = readLockfile(lockPath);
    expect(loaded).toBeDefined();
    expect(loaded?.packages["@kerangka/std"]?.version).toBe("0.1.0");

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});

describe("Trait Expansion in Compiler", () => {
  it("expands standard traits into entity fields and defaults", () => {
    const kir = compile({
      kerangka: "0.1",
      app: "audit-test",
      entities: {
        Document: {
          traits: ["std:auditable", "std:tenantScoped"],
          fields: {
            title: "string!",
          },
        },
      },
    });

    const doc = kir.entities.Document!;
    expect(doc).toBeDefined();
    expect(doc.fields.title).toBeDefined();
    expect(doc.fields.createdAt).toBeDefined();
    expect(doc.fields.createdBy).toBeDefined();
    expect(doc.fields.updatedAt).toBeDefined();
    expect(doc.fields.updatedBy).toBeDefined();
    expect(doc.fields.tenantId).toBeDefined();

    expect(doc.fields.createdAt?.default).toBe("now()");
    expect(doc.fields.createdBy?.default).toBe("actor.id");
    expect(doc.fields.tenantId?.default).toBe("actor.tenantId");
    expect(doc.readFilter).toBe("tenantId == actor.tenantId");
  });

  it("combines multiple trait readFilters", () => {
    const kir = compile({
      kerangka: "0.1",
      app: "filter-test",
      entities: {
        Invoice: {
          traits: ["std:softDelete", "std:tenantScoped"],
          fields: {
            number: "string! unique",
          },
        },
      },
    });

    const invoice = kir.entities.Invoice!;
    expect(invoice.fields.deletedAt).toBeDefined();
    expect(invoice.fields.deletedBy).toBeDefined();
    expect(invoice.fields.tenantId).toBeDefined();
    expect(invoice.readFilter).toBe("(deletedAt == null) && (tenantId == actor.tenantId)");
  });

  it("detects silent field collision with trait as compile error", () => {
    expect(() =>
      compile({
        kerangka: "0.1",
        app: "collision-test",
        entities: {
          Invoice: {
            traits: ["std:tenantScoped"],
            fields: {
              tenantId: "string!", // Collision!
            },
          },
        },
      })
    ).toThrow(CompilerError);

    try {
      compile({
        kerangka: "0.1",
        app: "collision-test",
        entities: {
          Invoice: {
            traits: ["std:tenantScoped"],
            fields: {
              tenantId: "string!",
            },
          },
        },
      });
    } catch (err) {
      const cErr = err as CompilerError;
      expect(cErr.diagnostics.some((d) => d.code === "TRAIT_FIELD_COLLISION")).toBe(true);
    }
  });

  it("allows explicit field exclusion to avoid collision", () => {
    const kir = compile({
      kerangka: "0.1",
      app: "exclude-test",
      entities: {
        Invoice: {
          traits: [
            {
              trait: "std:auditable",
              exclude: ["updatedAt", "updatedBy"],
            },
          ],
          fields: {
            updatedAt: "datetime! = now()", // Explicitly overridden via exclusion
          },
        },
      },
    });

    const invoice = kir.entities.Invoice!;
    expect(invoice.fields.createdAt).toBeDefined();
    expect(invoice.fields.createdBy).toBeDefined();
    expect(invoice.fields.updatedAt).toBeDefined();
    expect(invoice.fields.updatedAt?.type).toBe("datetime");
    expect(invoice.fields.updatedBy).toBeUndefined(); // Excluded
  });

  it("resolves standard value types in field definitions", () => {
    const kir = compile({
      kerangka: "0.1",
      app: "types-test",
      entities: {
        Account: {
          fields: {
            balance: "std:Money!",
            billingAddress: "Address",
            activePeriod: "Period",
          },
        },
      },
    });

    const account = kir.entities.Account!;
    expect(account.fields.balance?.type).toBe("std:Money");
    expect(account.fields.billingAddress?.type).toBe("Address");
    expect(account.fields.activePeriod?.type).toBe("Period");
  });
});
