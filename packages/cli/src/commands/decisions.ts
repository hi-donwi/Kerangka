/**
 * Kerangka CLI - Decisions Command
 * Import and export decision tables between CSV and Kerangka documents (PLAN.md §21).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export interface DecisionExportOptions {
  from: string;
  output?: string;
}

export interface DecisionImportOptions {
  into: string;
  hitPolicy?: "first" | "unique" | "collect" | "priority";
}

function escapeCsvCell(val: unknown): string {
  if (val === undefined || val === null) return "";
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}

function parseCsvLine(line: string): string[] {
  const result: string[] = [];
  let curr = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i]!;
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        curr += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(curr.trim());
      curr = "";
    } else {
      curr += char;
    }
  }
  result.push(curr.trim());
  return result;
}

export function decisionsExportCommand(tableName: string, options: DecisionExportOptions): boolean {
  const docPath = resolve(process.cwd(), options.from);
  if (!existsSync(docPath)) {
    console.error(`Error: Document '${docPath}' does not exist.`);
    return false;
  }

  let doc;
  try {
    doc = JSON.parse(readFileSync(docPath, "utf8"));
  } catch (err) {
    console.error(`Error: Failed to parse document '${docPath}': ${(err as Error).message}`);
    return false;
  }

  const table = doc.decisions?.[tableName];
  if (!table) {
    console.error(`Error: Decision table '${tableName}' not found in '${docPath}'.`);
    return false;
  }

  const inputs: Array<{ name: string; type?: string }> = Array.isArray(table.inputs) ? table.inputs : [];
  const outputs: Array<{ name: string; type?: string }> = Array.isArray(table.outputs) ? table.outputs : [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rules: Array<{ inputs: any[]; outputs: Record<string, unknown> }> = Array.isArray(table.rules)
    ? table.rules
    : [];

  // Header row: in:col1,in:col2,...,out:colA,out:colB
  const headerParts = [
    ...inputs.map((i) => `in:${i.name}`),
    ...outputs.map((o) => `out:${o.name}`),
  ];
  const lines = [headerParts.join(",")];

  for (const rule of rules) {
    const rowParts: string[] = [];
    for (let i = 0; i < inputs.length; i++) {
      rowParts.push(escapeCsvCell(rule.inputs?.[i] ?? "-"));
    }
    for (const outCol of outputs) {
      rowParts.push(escapeCsvCell(rule.outputs?.[outCol.name] ?? ""));
    }
    lines.push(rowParts.join(","));
  }

  const csvContent = lines.join("\n") + "\n";

  if (options.output) {
    const outPath = resolve(process.cwd(), options.output);
    writeFileSync(outPath, csvContent, "utf8");
    console.log(`Exported decision table '${tableName}' (${rules.length} rules) to ${outPath}`);
  } else {
    process.stdout.write(csvContent);
  }

  return true;
}

export function decisionsImportCommand(
  tableName: string,
  csvFilePath: string,
  options: DecisionImportOptions
): boolean {
  const docPath = resolve(process.cwd(), options.into);
  if (!existsSync(docPath)) {
    console.error(`Error: Target document '${docPath}' does not exist.`);
    return false;
  }

  const csvPath = resolve(process.cwd(), csvFilePath);
  if (!existsSync(csvPath)) {
    console.error(`Error: CSV file '${csvPath}' does not exist.`);
    return false;
  }

  const csvRaw = readFileSync(csvPath, "utf8").trim();
  const rawLines = csvRaw.split("\n").map((l) => l.trim()).filter(Boolean);
  if (rawLines.length === 0) {
    console.error(`Error: CSV file '${csvPath}' is empty.`);
    return false;
  }

  // Parse header
  const header = parseCsvLine(rawLines[0]!);
  const inputCols: Array<{ index: number; name: string }> = [];
  const outputCols: Array<{ index: number; name: string }> = [];

  for (let idx = 0; idx < header.length; idx++) {
    const colName = header[idx]!;
    if (colName.toLowerCase().startsWith("in:") || colName.toLowerCase().startsWith("in_")) {
      inputCols.push({ index: idx, name: colName.slice(3).trim() });
    } else if (colName.toLowerCase().startsWith("out:") || colName.toLowerCase().startsWith("out_")) {
      outputCols.push({ index: idx, name: colName.slice(4).trim() });
    } else {
      // Default to input if not specified
      inputCols.push({ index: idx, name: colName.trim() });
    }
  }

  // Parse rule rows
  const rules = [];
  for (let lineIdx = 1; lineIdx < rawLines.length; lineIdx++) {
    const row = parseCsvLine(rawLines[lineIdx]!);
    const ruleInputs = inputCols.map((c) => {
      const rawVal = row[c.index] ?? "-";
      return rawVal === "" ? "-" : rawVal;
    });

    const ruleOutputs: Record<string, unknown> = {};
    for (const outCol of outputCols) {
      const rawVal = row[outCol.index];
      if (rawVal !== undefined && rawVal !== "") {
        // Attempt parsing number or boolean
        if (rawVal.toLowerCase() === "true") ruleOutputs[outCol.name] = true;
        else if (rawVal.toLowerCase() === "false") ruleOutputs[outCol.name] = false;
        else if (!isNaN(Number(rawVal)) && !rawVal.includes(" ")) ruleOutputs[outCol.name] = Number(rawVal);
        else ruleOutputs[outCol.name] = rawVal;
      }
    }

    rules.push({
      inputs: ruleInputs,
      outputs: ruleOutputs,
    });
  }

  let doc;
  try {
    doc = JSON.parse(readFileSync(docPath, "utf8"));
  } catch (err) {
    console.error(`Error: Failed to parse document '${docPath}': ${(err as Error).message}`);
    return false;
  }

  if (!doc.decisions) {
    doc.decisions = {};
  }

  const existingTable = doc.decisions[tableName] || {};
  doc.decisions[tableName] = {
    ...existingTable,
    hitPolicy: options.hitPolicy || existingTable.hitPolicy || "first",
    inputs: inputCols.map((c) => ({ name: c.name, type: "string" })),
    outputs: outputCols.map((c) => ({ name: c.name, type: "string" })),
    rules,
  };

  writeFileSync(docPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
  console.log(`Imported ${rules.length} rules into decision table '${tableName}' in ${docPath}`);
  return true;
}
