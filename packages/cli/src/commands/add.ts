/**
 * Kerangka CLI - Add Command
 * Scaffolds bounded contexts, aggregates, actions, policies, queries, and views (PLAN.md §7.3, §7.9, §13).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

export interface AddOptions {
  /** Target context when operating inside a multi-context workspace. */
  context?: string;
  /** Event trigger for 'policy' (e.g. 'orders.OrderPlaced'). */
  on?: string;
  /** Action target for 'policy' (e.g. 'Invoice.create'). */
  run?: string;
  /** Authoring format: 'json' or 'yaml'. */
  format?: "json" | "yaml";
}

const MANIFEST_NAMES = ["kerangka.json", "kerangka.yaml", "kerangka.yml"];

export function addCommand(type: string, name: string, options: AddOptions = {}): boolean {
  if (!type || !name) {
    console.error("Error: 'add' requires both a component type and a name.");
    console.error("Usage: kerangka add <context|aggregate|action|policy|query|view> <name> [options]");
    return false;
  }

  const normalizedType = type.toLowerCase();
  const rootManifestPath = findRootManifest(process.cwd());

  try {
    switch (normalizedType) {
      case "context":
        return addContext(name, rootManifestPath, options);
      case "aggregate":
      case "entity":
        return addAggregate(name, rootManifestPath, options);
      case "action":
        return addAction(name, rootManifestPath, options);
      case "policy":
        return addPolicy(name, rootManifestPath, options);
      case "query":
        return addQuery(name, rootManifestPath, options);
      case "view":
        return addView(name, rootManifestPath, options);
      default:
        console.error(`Error: Unknown component type '${type}'.`);
        console.error("Valid types: context, aggregate, action, policy, query, view");
        return false;
    }
  } catch (err) {
    console.error(`Error: Failed to add ${normalizedType} '${name}': ${(err as Error).message}`);
    return false;
  }
}

function findRootManifest(dir: string): string | undefined {
  let curr = resolve(dir);
  while (true) {
    for (const m of MANIFEST_NAMES) {
      const candidate = join(curr, m);
      if (existsSync(candidate)) return candidate;
    }
    const parent = resolve(curr, "..");
    if (parent === curr) break;
    curr = parent;
  }
  return undefined;
}

function addContext(contextName: string, manifestPath?: string, options: AddOptions = {}): boolean {
  const kebabName = toKebabCase(contextName);
  const baseDir = manifestPath ? resolve(manifestPath, "..") : process.cwd();
  const contextDir = join(baseDir, "contexts", kebabName);

  if (existsSync(contextDir)) {
    console.error(`Error: Context directory 'contexts/${kebabName}' already exists.`);
    return false;
  }

  mkdirSync(join(contextDir, "aggregates"), { recursive: true });
  mkdirSync(join(contextDir, "views"), { recursive: true });
  mkdirSync(join(contextDir, "policies"), { recursive: true });
  mkdirSync(join(contextDir, "tests"), { recursive: true });

  const ext = options.format === "yaml" || (manifestPath && manifestPath.endsWith(".yaml")) ? "yaml" : "json";
  const contextDef = {
    context: kebabName,
    description: `${kebabName} bounded context`,
    glossary: {},
    exports: {
      entities: [],
      events: [],
      queries: [],
    },
    entities: {},
    events: {},
  };

  const manifestFile = join(contextDir, `context.kerangka.${ext}`);
  writeConfigFile(manifestFile, contextDef);

  // Update root manifest if present
  if (manifestPath && existsSync(manifestPath)) {
    const raw = readConfigFile(manifestPath);
    if (typeof raw === "object" && raw !== null) {
      const contexts = Array.isArray(raw.contexts) ? raw.contexts : [];
      if (!contexts.includes(kebabName)) {
        contexts.push(kebabName);
        raw.contexts = contexts;
        writeConfigFile(manifestPath, raw);
        console.log(`Updated workspace manifest '${manifestPath}' to include context '${kebabName}'.`);
      }
    }
  }

  console.log(`Created bounded context '${kebabName}' at: contexts/${kebabName}`);
  return true;
}

function addAggregate(aggregateName: string, manifestPath?: string, options: AddOptions = {}): boolean {
  const pascalName = toPascalCase(aggregateName);
  const baseDir = manifestPath ? resolve(manifestPath, "..") : process.cwd();

  // If in a multi-context workspace, determine target context
  let targetDir = baseDir;
  let inContext = false;

  if (options.context) {
    targetDir = join(baseDir, "contexts", options.context, "aggregates");
    inContext = true;
  } else if (existsSync(join(baseDir, "contexts"))) {
    // If contexts directory exists but no context specified, look for first context
    const firstCtx = resolveFirstContext(baseDir);
    if (firstCtx) {
      targetDir = join(baseDir, "contexts", firstCtx, "aggregates");
      inContext = true;
      console.log(`Note: No --context specified. Defaulting to context '${firstCtx}'.`);
    }
  }

  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  const ext = options.format === "yaml" || (manifestPath && manifestPath.endsWith(".yaml")) ? "yaml" : "json";
  const aggFile = join(targetDir, `${pascalName}.kerangka.${ext}`);

  if (existsSync(aggFile)) {
    console.error(`Error: Aggregate file '${aggFile}' already exists.`);
    return false;
  }

  const aggDef = {
    aggregate: pascalName,
    fields: {
      name: "string! >= 2 <= 100",
      status: "enum(draft, active, archived) = draft",
      createdAt: "datetime",
    },
    workflow: {
      field: "status",
      transitions: {
        activate: {
          from: "draft",
          to: "active",
        },
        archive: {
          from: ["draft", "active"],
          to: "archived",
        },
      },
    },
    actions: {
      updateName: {
        input: {
          name: "string! >= 2 <= 100",
        },
        run: {
          name: "input.name",
        },
      },
    },
  };

  writeConfigFile(aggFile, aggDef);
  console.log(`Created aggregate '${pascalName}' at: ${aggFile}`);

  // Create companion test scenario
  if (inContext) {
    const testDir = join(targetDir, "..", "tests");
    mkdirSync(testDir, { recursive: true });
    const testFile = join(testDir, `${pascalName}.test.kerangka.${ext}`);
    if (!existsSync(testFile)) {
      const testDef = {
        test: `${pascalName} Lifecycle`,
        aggregate: pascalName,
        scenarios: [
          {
            name: "initial creation and activation",
            initial: { name: "Sample Item", status: "draft" },
            transition: "activate",
            expect: { status: "active" },
          },
        ],
      };
      writeConfigFile(testFile, testDef);
      console.log(`Created companion scenario at: ${testFile}`);
    }
  }

  return true;
}

function addAction(actionPath: string, manifestPath?: string, options: AddOptions = {}): boolean {
  // Expected syntax: Entity.action or just actionName
  const parts = actionPath.split(".");
  const entityName = parts.length > 1 ? toPascalCase(parts[0]!) : undefined;
  const actionName = parts.length > 1 ? toCamelCase(parts[1]!) : toCamelCase(parts[0]!);

  const baseDir = manifestPath ? resolve(manifestPath, "..") : process.cwd();
  const contextName = options.context ?? resolveFirstContext(baseDir);

  let targetFile: string | undefined;

  if (contextName && entityName) {
    const cand1 = join(baseDir, "contexts", contextName, "aggregates", `${entityName}.kerangka.json`);
    const cand2 = join(baseDir, "contexts", contextName, "aggregates", `${entityName}.kerangka.yaml`);
    if (existsSync(cand1)) targetFile = cand1;
    else if (existsSync(cand2)) targetFile = cand2;
  }

  if (!targetFile && manifestPath && existsSync(manifestPath)) {
    targetFile = manifestPath;
  }

  if (!targetFile) {
    console.error(`Error: Could not locate aggregate definition for action '${actionPath}'.`);
    return false;
  }

  const doc = readConfigFile(targetFile) as Record<string, any>;
  const newAction = {
    input: {},
    run: {},
  };

  if (doc.aggregate && doc.aggregate === entityName) {
    doc.actions = doc.actions ?? {};
    doc.actions[actionName] = newAction;
    writeConfigFile(targetFile, doc);
    console.log(`Added action '${actionName}' to aggregate '${entityName}' in ${targetFile}`);
    return true;
  } else if (doc.entities && entityName && doc.entities[entityName]) {
    doc.entities[entityName].actions = doc.entities[entityName].actions ?? {};
    doc.entities[entityName].actions[actionName] = newAction;
    writeConfigFile(targetFile, doc);
    console.log(`Added action '${actionName}' to entity '${entityName}' in ${targetFile}`);
    return true;
  }

  console.error(`Error: Entity '${entityName}' not found in ${targetFile}.`);
  return false;
}

function addPolicy(policyName: string, manifestPath?: string, options: AddOptions = {}): boolean {
  const camelName = toCamelCase(policyName);
  const baseDir = manifestPath ? resolve(manifestPath, "..") : process.cwd();
  const contextName = options.context ?? resolveFirstContext(baseDir);

  if (!contextName) {
    console.error("Error: 'policy' must belong to a context in a multi-context workspace.");
    return false;
  }

  const contextManifest = findContextManifest(baseDir, contextName);
  if (!contextManifest) {
    console.error(`Error: Context '${contextName}' manifest not found.`);
    return false;
  }

  const doc = readConfigFile(contextManifest) as Record<string, any>;
  doc.policies = doc.policies ?? {};

  doc.policies[camelName] = {
    on: options.on ?? "foreignContext.EventHappened",
    run: options.run ?? "LocalAggregate.create",
  };

  writeConfigFile(contextManifest, doc);
  console.log(`Added policy '${camelName}' to context '${contextName}' in ${contextManifest}`);
  return true;
}

function addQuery(queryName: string, manifestPath?: string, options: AddOptions = {}): boolean {
  const camelName = toCamelCase(queryName);
  const baseDir = manifestPath ? resolve(manifestPath, "..") : process.cwd();
  const contextName = options.context ?? resolveFirstContext(baseDir);

  const targetFile = contextName ? findContextManifest(baseDir, contextName) : manifestPath;
  if (!targetFile) {
    console.error("Error: Could not locate target manifest for query.");
    return false;
  }

  const doc = readConfigFile(targetFile) as Record<string, any>;
  doc.queries = doc.queries ?? {};

  doc.queries[camelName] = {
    entity: "MainEntity",
    pageSize: 20,
    filter: {},
  };

  writeConfigFile(targetFile, doc);
  console.log(`Added query '${camelName}' to ${targetFile}`);
  return true;
}

function addView(viewName: string, manifestPath?: string, options: AddOptions = {}): boolean {
  const kebabName = toKebabCase(viewName);
  const baseDir = manifestPath ? resolve(manifestPath, "..") : process.cwd();
  const contextName = options.context ?? resolveFirstContext(baseDir);

  const viewsDir = contextName
    ? join(baseDir, "contexts", contextName, "views")
    : join(baseDir, "views");

  if (!existsSync(viewsDir)) {
    mkdirSync(viewsDir, { recursive: true });
  }

  const viewFile = join(viewsDir, `${kebabName}.uidl.json`);
  if (existsSync(viewFile)) {
    console.error(`Error: View file '${viewFile}' already exists.`);
    return false;
  }

  const uidlView = {
    version: "1.0",
    name: kebabName,
    type: "list",
    title: `${toPascalCase(viewName)} Overview`,
    dataSource: {
      query: `get${toPascalCase(viewName)}List`,
    },
    columns: [
      { name: "id", label: "ID" },
      { name: "status", label: "Status" },
    ],
  };

  writeFileSync(viewFile, JSON.stringify(uidlView, null, 2) + "\n", "utf8");
  console.log(`Created UIDL view '${kebabName}' at: ${viewFile}`);
  return true;
}

function resolveFirstContext(baseDir: string): string | undefined {
  const contextsDir = join(baseDir, "contexts");
  if (existsSync(contextsDir)) {
    const list = readdirSyncSafe(contextsDir);
    if (list.length > 0) return list[0];
  }
  return undefined;
}

function findContextManifest(baseDir: string, contextName: string): string | undefined {
  const ctxDir = join(baseDir, "contexts", contextName);
  for (const name of ["context.kerangka.json", "context.kerangka.yaml", "context.kerangka.yml"]) {
    const cand = join(ctxDir, name);
    if (existsSync(cand)) return cand;
  }
  return undefined;
}

function readdirSyncSafe(dir: string): string[] {
  try {
    return require("node:fs").readdirSync(dir);
  } catch {
    return [];
  }
}

function readConfigFile(filePath: string): any {
  const text = readFileSync(filePath, "utf8");
  return text.trim().startsWith("{") ? JSON.parse(text) : parseYaml(text);
}

function writeConfigFile(filePath: string, data: unknown): void {
  const isYaml = filePath.endsWith(".yaml") || filePath.endsWith(".yml");
  const content = isYaml ? stringifyYaml(data) : JSON.stringify(data, null, 2) + "\n";
  writeFileSync(filePath, content, "utf8");
}

function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/[\s_]+/g, "-")
    .toLowerCase();
}

function toPascalCase(str: string): string {
  return str
    .replace(/(?:^\w|[A-Z]|\b\w)/g, (letter) => letter.toUpperCase())
    .replace(/[\s\-_]+/g, "");
}

function toCamelCase(str: string): string {
  const pascal = toPascalCase(str);
  return pascal.charAt(0).toLowerCase() + pascal.slice(1);
}
