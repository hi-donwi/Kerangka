/**
 * Kerangka SQL Migration Differ
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 *
 * Compares two KIR documents (or a KIR document against a live SQLite database
 * or a SQL schema file) and generates plain SQL migrations (PostgreSQL and SQLite)
 * supporting expand/contract zero-downtime phasing, column renaming (renamedFrom),
 * and destructive operations detection (PLAN.md §8.4, §21, R19, ADR-0021, ADR-0032).
 */

import { FieldDefinition, KIRDocument } from "../types.js";
import { DDLGenerator, SQLDialect, toSnakeCase } from "./generator.js";

export type MigrationPhase = "all" | "expand" | "contract";

export interface DBMigrationOptions {
  dialect?: SQLDialect;
  schema?: string;
  phase?: MigrationPhase;
  allowDestructive?: boolean;
}

export type DBMigrationStepType =
  | "create_table"
  | "drop_table"
  | "add_column"
  | "drop_column"
  | "rename_column"
  | "alter_column_type"
  | "alter_column_nullability"
  | "create_index"
  | "drop_index";

export interface DBMigrationStep {
  type: DBMigrationStepType;
  table: string;
  column?: string;
  destructive: boolean;
  phase: "expand" | "contract";
  sql: string;
  description: string;
}

export interface DBMigrationResult {
  dialect: SQLDialect;
  phase: MigrationPhase;
  hasDestructiveSteps: boolean;
  destructiveSteps: DBMigrationStep[];
  steps: DBMigrationStep[];
  sql: string;
  summary: {
    tablesCreated: number;
    tablesDropped: number;
    columnsAdded: number;
    columnsDropped: number;
    columnsRenamed: number;
    columnsModified: number;
    indexesCreated: number;
    indexesDropped: number;
    destructiveCount: number;
  };
}

/** Infers a Kerangka field definition from a SQL column type declaration. */
export function sqlTypeToFieldType(sqlType: string, columnName: string): FieldDefinition {
  const base = sqlType.trim().toUpperCase();
  const lowerName = columnName.toLowerCase();

  const parenMatch = base.match(/^([A-Z]+)\s*\(([^)]*)\)\s*$/);
  const head = parenMatch ? parenMatch[1]! : base;
  const args = parenMatch ? parenMatch[2]!.split(",").map((s) => s.trim()) : [];

  let field: FieldDefinition;
  switch (head) {
    case "INT":
    case "INTEGER":
    case "BIGINT":
    case "SMALLINT":
      field = { type: "int", required: false };
      break;
    case "NUMERIC":
    case "DECIMAL":
    case "REAL":
    case "FLOAT":
    case "DOUBLE": {
      const precision = Number(args[0]);
      const scale = Number(args[1]);
      field = {
        type: "decimal",
        required: false,
        ...(Number.isFinite(precision) ? { precision } : {}),
        ...(Number.isFinite(scale) ? { scale } : {}),
      };
      break;
    }
    case "BOOLEAN":
    case "BOOL":
      field = { type: "boolean", required: false };
      break;
    case "DATE":
      field = { type: "date", required: false };
      break;
    case "TIME":
      field = { type: "time", required: false };
      break;
    case "TIMESTAMPTZ":
    case "TIMESTAMP":
    case "DATETIME":
      field = { type: "datetime", required: false };
      break;
    case "UUID":
      field = { type: "uuid", required: false };
      break;
    case "JSONB":
    case "JSON":
      field = { type: "list", required: false };
      break;
    case "VARCHAR":
    case "CHARACTER":
    case "NVARCHAR":
    case "TEXT":
    case "CLOB":
    default: {
      // Heuristics for identifier and timestamp columns stored as TEXT/VARCHAR.
      if (head === "UUID" || lowerName === "id" || lowerName.endsWith("_id")) {
        field = { type: "uuid", required: false };
      } else if (lowerName.endsWith("_at")) {
        field = { type: "datetime", required: false };
      } else {
        field = { type: "string", required: false };
      }
      break;
    }
  }

  return field;
}

export function toCamelCase(name: string): string {
  return name
    .replace(/^tbl_/, "")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part, index) =>
      index === 0
        ? part.toLowerCase()
        : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()
    )
    .join("");
}

export function toPascalCase(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

/** Table-level keywords that start a constraint, not a column definition. */
const TABLE_CONSTRAINT_KEYWORDS = ["CONSTRAINT", "PRIMARY", "FOREIGN", "UNIQUE", "CHECK"];

export interface ParsedSqlColumn {
  name: string;
  type: string;
  notNull: boolean;
  default?: string;
}

export interface ParsedSqlTable {
  name: string;
  columns: ParsedSqlColumn[];
}

/** Extracts a literal DEFAULT expression from a column definition fragment. */
function extractDefault(rest: string): string | undefined {
  const match = rest.match(/\bDEFAULT\s+('(?:[^']|'')*'|[\w.()+\-']+)/i);
  return match ? match[1]! : undefined;
}

/**
 * Parses `CREATE TABLE` statements out of a SQL DDL script. Comment lines are
 * ignored; only the first definition per table name wins.
 */
export function parseSqlSchema(sql: string): ParsedSqlTable[] {
  const withoutComments = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");

  const tables: ParsedSqlTable[] = [];
  const createRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s*\(/gi;
  let match: RegExpExecArray | null;

  while ((match = createRegex.exec(withoutComments)) !== null) {
    const fullName = match[1]!;
    const tableName = fullName.includes(".") ? fullName.split(".").pop()! : fullName;

    // Walk to the matching closing paren, respecting string literals.
    let depth = 1;
    let index = createRegex.lastIndex;
    let inString = false;
    while (index < withoutComments.length && depth > 0) {
      const ch = withoutComments[index]!;
      if (ch === "'" && withoutComments[index - 1] !== "\\") inString = !inString;
      if (!inString) {
        if (ch === "(") depth += 1;
        if (ch === ")") depth -= 1;
      }
      index += 1;
    }
    const body = withoutComments.slice(createRegex.lastIndex, index - 1);

    const columns: ParsedSqlColumn[] = [];
    for (const def of splitTopLevel(body)) {
      const trimmed = def.trim();
      if (trimmed.length === 0) continue;
      const firstWord = trimmed.split(/\s+/)[0]!;
      if (TABLE_CONSTRAINT_KEYWORDS.includes(firstWord.toUpperCase())) continue;

      const columnMatch = trimmed.match(/^"?([A-Za-z_][A-Za-z0-9_]*)"?\s+([^\s]+(?:\([^)]*\))?)(.*)$/s);
      if (!columnMatch) continue;
      const [, name, type, rest = ""] = columnMatch;
      const defaultValue = extractDefault(rest);
      columns.push({
        name: name!,
        type: type!,
        notNull: rest.toUpperCase().includes("NOT NULL"),
        ...(defaultValue !== undefined ? { default: defaultValue } : {}),
      });
    }

    tables.push({ name: tableName, columns });
  }

  return tables;
}

/** Splits a CREATE TABLE body on top-level commas (depth 0 only). */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let current = "";

  for (let index = 0; index < body.length; index += 1) {
    const ch = body[index]!;
    if (ch === "'" && body[index - 1] !== "\\") inString = !inString;
    if (!inString) {
      if (ch === "(") depth += 1;
      if (ch === ")") depth -= 1;
      if (ch === "," && depth === 0) {
        parts.push(current);
        current = "";
        continue;
      }
    }
    current += ch;
  }
  if (current.trim().length > 0) parts.push(current);
  return parts;
}

/** Normalizes a raw SQL DEFAULT literal into a Kerangka field default value. */
function sqlDefaultToValue(raw: string): unknown {
  const text = raw.trim();
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  const upper = text.toUpperCase();
  if (upper === "TRUE") return true;
  if (upper === "FALSE") return false;
  if (/^'.*'$/.test(text)) return text.slice(1, -1).replace(/''/g, "'");
  return text;
}

function entitiesFromParsedTables(tables: ParsedSqlTable[]): KIRDocument["entities"] {
  const entities: KIRDocument["entities"] = {};
  for (const table of tables) {
    if (table.columns.length === 0) continue;

    const fields: Record<string, FieldDefinition> = {};
    for (const col of table.columns) {
      const field = sqlTypeToFieldType(col.type, col.name);
      field.required = col.notNull;
      if (col.default !== undefined) {
        field.default = sqlDefaultToValue(col.default);
      }
      fields[toCamelCase(col.name)] = field;
    }

    const tableSnake = toSnakeCase(table.name);
    const keyColumn =
      table.columns.find((c) => c.name.toLowerCase() === "id") ??
      table.columns.find((c) => c.name.toLowerCase() === `${tableSnake}_id`);
    entities[toPascalCase(table.name)] = {
      key: keyColumn ? toCamelCase(keyColumn.name) : "id",
      embedded: false,
      fields,
    };
  }
  return entities;
}

/**
 * Drafts a KIR document from a SQL DDL script (one entity per CREATE TABLE).
 */
export function loadSqlSchemaSource(sql: string): KIRDocument {
  return {
    kir: "0.1",
    app: "imported",
    meta: {
      title: "Imported from SQL schema",
      timezone: "UTC",
      compiledAt: new Date().toISOString(),
      compilerVersion: "0.1.0",
    },
    entities: entitiesFromParsedTables(parseSqlSchema(sql)),
  };
}

/**
 * Loads a SQLite database file and drafts a KIR document from its schema.
 * Uses the built-in `node:sqlite` module (Node 22.5+) — no external dependency.
 */
export async function loadSqliteSchema(dbPath: string): Promise<KIRDocument> {
  let DatabaseSync: typeof import("node:sqlite").DatabaseSync;
  try {
    ({ DatabaseSync } = await import("node:sqlite"));
  } catch {
    throw new Error(
      "SQLite introspection requires the built-in 'node:sqlite' module (Node.js 22.5+). " +
        "Export the schema to a .sql file instead: `sqlite3 db.sqlite .schema > schema.sql`."
    );
  }

  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as { name: string }[];

    const parsed: ParsedSqlTable[] = [];
    for (const { name } of tables) {
      const columns = db.prepare(`PRAGMA table_info("${name}")`).all() as {
        name: string;
        type: string;
        notnull: number;
        pk: number;
        dflt_value: unknown;
      }[];
      if (columns.length === 0) continue;

      parsed.push({
        name,
        columns: columns.map((col) => ({
          name: col.name,
          type: col.type || "TEXT",
          notNull: col.notnull === 1 || col.pk > 0,
          ...(col.dflt_value !== null && col.dflt_value !== undefined
            ? { default: String(col.dflt_value) }
            : {}),
        })),
      });
    }

    return {
      kir: "0.1",
      app: "imported",
      meta: {
        title: "Imported from SQLite database",
        timezone: "UTC",
        compiledAt: new Date().toISOString(),
        compilerVersion: "0.1.0",
      },
      entities: entitiesFromParsedTables(parsed),
    };
  } finally {
    db.close();
  }
}

export class DBMigrationDiffer {
  private readonly oldKir: KIRDocument;
  private readonly newKir: KIRDocument;
  private readonly options: Required<DBMigrationOptions>;

  constructor(oldKir: KIRDocument, newKir: KIRDocument, options: DBMigrationOptions = {}) {
    this.oldKir = oldKir;
    this.newKir = newKir;
    this.options = {
      dialect: options.dialect ?? "postgres",
      schema: options.schema ?? "",
      phase: options.phase ?? "all",
      allowDestructive: options.allowDestructive ?? false,
    };
  }

  static diff(
    oldKir: KIRDocument,
    newKir: KIRDocument,
    options?: DBMigrationOptions
  ): DBMigrationResult {
    const differ = new DBMigrationDiffer(oldKir, newKir, options);
    return differ.diff();
  }

  diff(): DBMigrationResult {
    const isPg = this.options.dialect === "postgres";
    const allSteps: DBMigrationStep[] = [];

    const oldEntities = this.oldKir.entities || {};
    const newEntities = this.newKir.entities || {};

    // 1. Added Tables (Expand phase)
    for (const [entityName, entity] of Object.entries(newEntities)) {
      if (oldEntities[entityName]) continue;
      const tableName = toSnakeCase(entityName);
      const subKir: KIRDocument = {
        ...this.newKir,
        entities: { [entityName]: entity },
      };
      const tableDdl = DDLGenerator.generate(subKir, {
        dialect: this.options.dialect,
        schema: this.options.schema,
        includeAuditColumns: true,
        includeDrop: false,
      });

      // Strip generator header comments from single-table DDL
      const sqlBody = tableDdl
        .split("\n")
        .filter((line) => !line.startsWith("--") && line.trim().length > 0)
        .join("\n");

      allSteps.push({
        type: "create_table",
        table: tableName,
        destructive: false,
        phase: "expand",
        sql: sqlBody,
        description: `Create table '${tableName}' for new entity '${entityName}'`,
      });
    }

    // 2. Dropped Tables (Contract phase - Destructive)
    for (const [entityName] of Object.entries(oldEntities)) {
      if (newEntities[entityName]) continue;
      const tableName = toSnakeCase(entityName);
      const dropSql = isPg
        ? `DROP TABLE IF EXISTS ${tableName} CASCADE;`
        : `DROP TABLE IF EXISTS ${tableName};`;

      allSteps.push({
        type: "drop_table",
        table: tableName,
        destructive: true,
        phase: "contract",
        sql: dropSql,
        description: `Drop table '${tableName}' for removed entity '${entityName}'`,
      });
    }

    // 3. Common Tables: Compare fields and schema
    for (const [entityName, oldEntity] of Object.entries(oldEntities)) {
      const newEntity = newEntities[entityName];
      if (!newEntity) continue;

      const tableName = toSnakeCase(entityName);
      const oldFields = oldEntity.fields || {};
      const newFields = newEntity.fields || {};

      const handledOldFields = new Set<string>();
      const handledNewFields = new Set<string>();

      // A. Column renames via 'renamedFrom' (Expand phase)
      for (const [newFieldName, newField] of Object.entries(newFields)) {
        const renameSource = newField.renamedFrom;
        if (!renameSource || !oldFields[renameSource] || newFields[renameSource]) continue;
        const oldCol = toSnakeCase(renameSource);
        const newCol = toSnakeCase(newFieldName);

        allSteps.push({
          type: "rename_column",
          table: tableName,
          column: newCol,
          destructive: false,
          phase: "expand",
          sql: `ALTER TABLE ${tableName} RENAME COLUMN ${oldCol} TO ${newCol};`,
          description: `Rename column '${oldCol}' to '${newCol}' via renamedFrom on '${tableName}'`,
        });

        handledOldFields.add(renameSource);
        handledNewFields.add(newFieldName);
      }

      // B. Added Columns (Expand phase)
      for (const [newFieldName, newField] of Object.entries(newFields)) {
        if (handledNewFields.has(newFieldName) || oldFields[newFieldName]) continue;

        const colName = toSnakeCase(newFieldName);
        const colDef = this.formatColumnDefinition(colName, newField);

        // Required field added without default is destructive in-place
        const isDestructive = Boolean(newField.required && newField.default === undefined);

        allSteps.push({
          type: "add_column",
          table: tableName,
          column: colName,
          destructive: isDestructive,
          phase: "expand",
          sql: `ALTER TABLE ${tableName} ADD COLUMN ${colDef};`,
          description: `Add column '${colName}' to '${tableName}'${isDestructive ? " [NOT NULL without default]" : ""}`,
        });

        if (newField.type === "ref" && newField.target) {
          const idxName = `idx_${tableName}_${colName}`;
          allSteps.push({
            type: "create_index",
            table: tableName,
            column: colName,
            destructive: false,
            phase: "expand",
            sql: `CREATE INDEX IF NOT EXISTS ${idxName} ON ${tableName} (${colName});`,
            description: `Create index '${idxName}' for reference field '${colName}' on '${tableName}'`,
          });
        }
      }

      // C. Dropped Columns (Contract phase - Destructive)
      for (const [oldFieldName, oldField] of Object.entries(oldFields)) {
        if (handledOldFields.has(oldFieldName) || newFields[oldFieldName]) continue;

        const colName = toSnakeCase(oldFieldName);
        const dropColSql = isPg
          ? `ALTER TABLE ${tableName} DROP COLUMN IF EXISTS ${colName} CASCADE;`
          : `ALTER TABLE ${tableName} DROP COLUMN ${colName};`;

        allSteps.push({
          type: "drop_column",
          table: tableName,
          column: colName,
          destructive: true,
          phase: "contract",
          sql: dropColSql,
          description: `Drop column '${colName}' from table '${tableName}'`,
        });

        // The foreign-key index on a dropped reference column goes with it.
        if (oldField.type === "ref" && oldField.target) {
          const idxName = `idx_${tableName}_${colName}`;
          allSteps.push({
            type: "drop_index",
            table: tableName,
            column: colName,
            destructive: false,
            phase: "contract",
            sql: `DROP INDEX IF EXISTS ${idxName};`,
            description: `Drop index '${idxName}' for removed reference column '${colName}' on '${tableName}'`,
          });
        }
      }

      // D. Modified Columns
      for (const [fieldName, oldField] of Object.entries(oldFields)) {
        const newField = newFields[fieldName];
        if (!newField || handledOldFields.has(fieldName)) continue;

        const colName = toSnakeCase(fieldName);

        // Type modification (Contract phase - Destructive)
        if (
          oldField.type !== newField.type ||
          oldField.precision !== newField.precision ||
          oldField.scale !== newField.scale
        ) {
          const typeSql = this.mapTypeOnly(newField);
          const alterTypeSql = isPg
            ? `ALTER TABLE ${tableName} ALTER COLUMN ${colName} TYPE ${typeSql} USING ${colName}::${typeSql};`
            : `-- SQLite requires table recreation to alter column type for '${tableName}.${colName}' to ${typeSql};`;

          allSteps.push({
            type: "alter_column_type",
            table: tableName,
            column: colName,
            destructive: true,
            phase: "contract",
            sql: alterTypeSql,
            description: `Alter type of column '${colName}' on '${tableName}' from ${oldField.type} to ${newField.type}`,
          });
        }

        // Nullability change
        if (oldField.required !== newField.required) {
          if (newField.required) {
            // Became NOT NULL (Destructive without a default)
            const alterNullSql = isPg
              ? `ALTER TABLE ${tableName} ALTER COLUMN ${colName} SET NOT NULL;`
              : `-- SQLite: enforce NOT NULL for '${tableName}.${colName}' via table recreation;`;

            allSteps.push({
              type: "alter_column_nullability",
              table: tableName,
              column: colName,
              destructive: newField.default === undefined,
              phase: "contract",
              sql: alterNullSql,
              description: `Set NOT NULL on column '${colName}' on table '${tableName}'`,
            });
          } else {
            // Became NULLABLE (Expand phase, non-destructive)
            const alterDropNullSql = isPg
              ? `ALTER TABLE ${tableName} ALTER COLUMN ${colName} DROP NOT NULL;`
              : `-- SQLite: remove NOT NULL on '${tableName}.${colName}' via table recreation;`;

            allSteps.push({
              type: "alter_column_nullability",
              table: tableName,
              column: colName,
              destructive: false,
              phase: "expand",
              sql: alterDropNullSql,
              description: `Drop NOT NULL on column '${colName}' on table '${tableName}'`,
            });
          }
        }
      }
    }

    // Expand steps run before contract steps; insertion order is stable within a phase.
    const orderedSteps = allSteps
      .slice()
      .sort((a, b) => (a.phase === b.phase ? 0 : a.phase === "expand" ? -1 : 1));

    const filteredSteps =
      this.options.phase === "all"
        ? orderedSteps
        : orderedSteps.filter((s) => s.phase === this.options.phase);

    const destructiveSteps = filteredSteps.filter((s) => s.destructive);
    const hasDestructive = destructiveSteps.length > 0;

    // Generate formatted SQL document
    const sql = this.formatMigrationScript(filteredSteps, destructiveSteps);

    const summary = {
      tablesCreated: filteredSteps.filter((s) => s.type === "create_table").length,
      tablesDropped: filteredSteps.filter((s) => s.type === "drop_table").length,
      columnsAdded: filteredSteps.filter((s) => s.type === "add_column").length,
      columnsDropped: filteredSteps.filter((s) => s.type === "drop_column").length,
      columnsRenamed: filteredSteps.filter((s) => s.type === "rename_column").length,
      columnsModified: filteredSteps.filter(
        (s) => s.type === "alter_column_type" || s.type === "alter_column_nullability"
      ).length,
      indexesCreated: filteredSteps.filter((s) => s.type === "create_index").length,
      indexesDropped: filteredSteps.filter((s) => s.type === "drop_index").length,
      destructiveCount: destructiveSteps.length,
    };

    return {
      dialect: this.options.dialect,
      phase: this.options.phase,
      hasDestructiveSteps: hasDestructive,
      destructiveSteps,
      steps: filteredSteps,
      sql,
      summary,
    };
  }

  private formatColumnDefinition(colName: string, field: FieldDefinition): string {
    const isPg = this.options.dialect === "postgres";
    const typeSql = this.mapTypeOnly(field);
    const constraints: string[] = [];

    if (field.required) {
      constraints.push("NOT NULL");
    }

    if (field.unique) {
      constraints.push("UNIQUE");
    }

    if (field.type === "enum" && field.values && field.values.length > 0) {
      const valList = field.values.map((v) => `'${v}'`).join(", ");
      constraints.push(`CHECK (${colName} IN (${valList}))`);
    }

    if (field.default !== undefined) {
      let defValSql = "";
      if (typeof field.default === "string") {
        if (field.default.endsWith("()")) {
          if (isPg) {
            defValSql = field.default.startsWith("today") ? "CURRENT_DATE" : "CURRENT_TIMESTAMP";
          } else {
            defValSql = field.default.startsWith("today") ? "date('now')" : "datetime('now')";
          }
        } else {
          defValSql = `'${field.default}'`;
        }
      } else if (typeof field.default === "boolean") {
        defValSql = isPg ? (field.default ? "TRUE" : "FALSE") : field.default ? "1" : "0";
      } else {
        defValSql = String(field.default);
      }
      constraints.push(`DEFAULT ${defValSql}`);
    }

    return `${colName} ${typeSql}${constraints.length > 0 ? " " + constraints.join(" ") : ""}`;
  }

  private mapTypeOnly(field: FieldDefinition): string {
    const isPg = this.options.dialect === "postgres";
    switch (field.type) {
      case "string":
      case "email":
        return "TEXT";
      case "int":
      case "integer":
        return "INTEGER";
      case "decimal":
        return isPg ? `NUMERIC(${field.precision ?? 14}, ${field.scale ?? 2})` : "NUMERIC";
      case "boolean":
      case "bool":
        return isPg ? "BOOLEAN" : "INTEGER";
      case "date":
        return isPg ? "DATE" : "TEXT";
      case "datetime":
      case "timestamp":
      case "instant":
        return isPg ? "TIMESTAMPTZ" : "TEXT";
      case "time":
        return isPg ? "TIME" : "TEXT";
      case "uuid":
        return isPg ? "UUID" : "TEXT";
      case "enum":
      case "ref":
        return isPg ? "VARCHAR(64)" : "TEXT";
      case "list":
        return isPg ? "JSONB" : "TEXT";
      default:
        return "TEXT";
    }
  }

  private formatMigrationScript(
    steps: DBMigrationStep[],
    destructiveSteps: DBMigrationStep[]
  ): string {
    const lines: string[] = [];
    lines.push(`-- ============================================================================`);
    lines.push(`-- Kerangka Database Migration (${this.options.dialect})`);
    lines.push(`-- Generated At: ${new Date().toISOString()}`);
    lines.push(`-- Phase: ${this.options.phase.toUpperCase()}`);
    lines.push(`-- Destructive Operations: ${destructiveSteps.length}`);
    lines.push(`-- ============================================================================`);

    // Prominently list destructive steps first (PLAN.md §8.4 & R19)
    if (destructiveSteps.length > 0) {
      lines.push(`\n-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
      lines.push(`-- WARNING: DESTRUCTIVE OPERATIONS DETECTED (${destructiveSteps.length})`);
      lines.push(`-- Review these steps carefully. They may result in data loss or lock tables.`);
      lines.push(`-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!`);
      for (const d of destructiveSteps) {
        lines.push(`-- [DESTRUCTIVE] (${d.phase}) ${d.description}`);
      }
      lines.push(`-- !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!\n`);
    }

    if (steps.length === 0) {
      lines.push(`\n-- No schema changes detected.\n`);
      return lines.join("\n");
    }

    let currentPhase = "";
    for (const step of steps) {
      if (this.options.phase === "all" && step.phase !== currentPhase) {
        currentPhase = step.phase;
        lines.push(`\n-- ----------------------------------------------------------------------------`);
        lines.push(
          `-- Phase: ${currentPhase.toUpperCase()} (${currentPhase === "expand" ? "Phase A: Backward-compatible" : "Phase B: Contract / Cleanup"})`
        );
        lines.push(`-- ----------------------------------------------------------------------------\n`);
      }

      lines.push(`-- ${step.description}${step.destructive ? " [DESTRUCTIVE]" : ""}`);
      lines.push(step.sql);
      lines.push("");
    }

    return lines.join("\n");
  }
}
