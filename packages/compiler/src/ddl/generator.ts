/**
 * Kerangka SQL DDL Generator
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { FieldDefinition, KIRDocument } from "../types.js";

export type SQLDialect = "postgres" | "sqlite";

export interface DDLOptions {
  dialect?: SQLDialect;
  schema?: string;
  includeAuditColumns?: boolean;
  includeDrop?: boolean;
}

export function toSnakeCase(str: string): string {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[-\s]+/g, "_")
    .toLowerCase();
}

export class DDLGenerator {
  private readonly kir: KIRDocument;
  private readonly options: Required<DDLOptions>;

  constructor(kir: KIRDocument, options: DDLOptions = {}) {
    this.kir = kir;
    this.options = {
      dialect: options.dialect ?? "postgres",
      schema: options.schema ?? "",
      includeAuditColumns: options.includeAuditColumns ?? true,
      includeDrop: options.includeDrop ?? false,
    };
  }

  static generate(kir: KIRDocument, options?: DDLOptions): string {
    const gen = new DDLGenerator(kir, options);
    return gen.generate();
  }

  generate(): string {
    const isPg = this.options.dialect === "postgres";
    const lines: string[] = [];

    lines.push(`-- ============================================================================`);
    lines.push(`-- Kerangka Generated DDL (${isPg ? "PostgreSQL" : "SQLite"})`);
    lines.push(`-- Application: ${this.kir.app} (v${this.kir.meta.version})`);
    lines.push(`-- Generated At: ${new Date().toISOString()}`);
    lines.push(`-- Compiler Version: ${this.kir.meta.compilerVersion}`);
    lines.push(`-- ============================================================================\n`);

    if (isPg && this.options.schema) {
      lines.push(`CREATE SCHEMA IF NOT EXISTS ${this.options.schema};`);
      lines.push(`SET search_path TO ${this.options.schema}, public;\n`);
    }

    const tenantConfig = this.kir.multitenancy;
    const hasDiscriminatorTenant = tenantConfig?.strategy === "discriminator";
    const tenantColName = hasDiscriminatorTenant ? toSnakeCase(tenantConfig.field ?? "tenantId") : null;

    // Process tables
    for (const [entityName, entity] of Object.entries(this.kir.entities)) {
      const tableName = toSnakeCase(entityName);
      const pkField = entity.key || "id";

      if (this.options.includeDrop) {
        lines.push(`DROP TABLE IF EXISTS ${tableName} CASCADE;`);
      }

      lines.push(`CREATE TABLE IF NOT EXISTS ${tableName} (`);

      const colDefs: string[] = [];
      const constraints: string[] = [];
      const indexStatements: string[] = [];

      // 1. Tenant column if multitenant discriminator
      if (tenantColName) {
        colDefs.push(`  ${tenantColName} VARCHAR(64) NOT NULL`);
      }

      // 2. Ensure primary key column exists even if implicit (e.g. default 'id')
      const pkCol = toSnakeCase(pkField);
      if (!entity.fields[pkField] && !entity.fields[pkCol]) {
        colDefs.push(`  ${pkCol} TEXT NOT NULL`);
      }

      // 3. Entity fields
      for (const [fieldName, field] of Object.entries(entity.fields)) {
        const colName = toSnakeCase(fieldName);
        const isPk = fieldName === pkField;
        const colSql = this.mapColumnType(colName, field, isPk);
        colDefs.push(`  ${colSql}`);

        // Track foreign key indexes
        if (field.type === "ref" && field.target) {
          const targetTable = toSnakeCase(field.target);
          const targetPk = toSnakeCase(this.kir.entities[field.target]?.key ?? "id");
          constraints.push(`  CONSTRAINT fk_${tableName}_${colName} FOREIGN KEY (${colName}) REFERENCES ${targetTable} (${targetPk})`);
          indexStatements.push(`CREATE INDEX IF NOT EXISTS idx_${tableName}_${colName} ON ${tableName} (${colName});`);
        }
      }

      // 3. Audit Columns
      if (this.options.includeAuditColumns) {
        if (isPg) {
          colDefs.push(`  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`);
          colDefs.push(`  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP`);
        } else {
          colDefs.push(`  created_at TEXT NOT NULL DEFAULT (datetime('now'))`);
          colDefs.push(`  updated_at TEXT NOT NULL DEFAULT (datetime('now'))`);
        }
        colDefs.push(`  created_by VARCHAR(64)`);
        colDefs.push(`  updated_by VARCHAR(64)`);
      }

      // 4. Primary Key constraint
      const pkColName = toSnakeCase(pkField);
      if (tenantColName) {
        constraints.push(`  CONSTRAINT pk_${tableName} PRIMARY KEY (${tenantColName}, ${pkColName})`);
      } else {
        constraints.push(`  CONSTRAINT pk_${tableName} PRIMARY KEY (${pkColName})`);
      }

      const allTableElements = [...colDefs, ...constraints];
      lines.push(allTableElements.join(",\n"));
      lines.push(`);\n`);

      // Add tenant index if applicable
      if (tenantColName) {
        indexStatements.push(`CREATE INDEX IF NOT EXISTS idx_${tableName}_tenant ON ${tableName} (${tenantColName});`);
      }

      // Emit indexes
      if (indexStatements.length > 0) {
        lines.push(indexStatements.join("\n"));
        lines.push("");
      }
    }

    return lines.join("\n");
  }

  private mapColumnType(colName: string, field: FieldDefinition, isPk: boolean): string {
    const isPg = this.options.dialect === "postgres";
    let typeSql = "";
    const constraints: string[] = [];

    switch (field.type) {
      case "string":
      case "email":
        typeSql = isPg ? "TEXT" : "TEXT";
        break;

      case "int":
      case "integer":
        typeSql = isPg ? "INTEGER" : "INTEGER";
        break;

      case "decimal":
        if (isPg) {
          const p = field.precision ?? 14;
          const s = field.scale ?? 2;
          typeSql = `NUMERIC(${p}, ${s})`;
        } else {
          typeSql = "NUMERIC";
        }
        break;

      case "boolean":
      case "bool":
        typeSql = isPg ? "BOOLEAN" : "INTEGER";
        break;

      case "date":
        typeSql = isPg ? "DATE" : "TEXT";
        break;

      case "datetime":
        typeSql = isPg ? "TIMESTAMPTZ" : "TEXT";
        break;

      case "uuid":
        typeSql = isPg ? "UUID" : "TEXT";
        break;

      case "enum": {
        typeSql = isPg ? "VARCHAR(64)" : "TEXT";
        if (field.values && field.values.length > 0) {
          const valList = field.values.map((v) => `'${v}'`).join(", ");
          constraints.push(`CHECK (${colName} IN (${valList}))`);
        }
        break;
      }

      case "ref":
        typeSql = isPg ? "VARCHAR(64)" : "TEXT";
        break;

      case "list":
        typeSql = isPg ? "JSONB" : "TEXT";
        break;

      default:
        typeSql = isPg ? "TEXT" : "TEXT";
        break;
    }

    if (field.required || isPk) {
      constraints.push("NOT NULL");
    }

    if (field.unique && !isPk) {
      constraints.push("UNIQUE");
    }

    if (field.min !== undefined && ["int", "decimal"].includes(field.type)) {
      constraints.push(`CHECK (${colName} >= ${field.min})`);
    }

    if (field.max !== undefined && ["int", "decimal"].includes(field.type)) {
      constraints.push(`CHECK (${colName} <= ${field.max})`);
    }

    if (field.default !== undefined) {
      let defValSql = "";
      if (typeof field.default === "string") {
        if (field.default.endsWith("()")) {
          // Function calls like today(), now()
          if (isPg) {
            defValSql = field.default.startsWith("today") ? "CURRENT_DATE" : "CURRENT_TIMESTAMP";
          } else {
            defValSql = field.default.startsWith("today") ? "date('now')" : "datetime('now')";
          }
        } else {
          defValSql = `'${field.default}'`;
        }
      } else if (typeof field.default === "boolean") {
        defValSql = isPg ? (field.default ? "TRUE" : "FALSE") : (field.default ? "1" : "0");
      } else {
        defValSql = String(field.default);
      }
      constraints.push(`DEFAULT ${defValSql}`);
    }

    return `${colName} ${typeSql}${constraints.length > 0 ? " " + constraints.join(" ") : ""}`;
  }
}
