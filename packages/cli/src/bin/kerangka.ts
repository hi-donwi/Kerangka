#!/usr/bin/env node
/**
 * Kerangka CLI Entrypoint
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { parseArgs } from "node:util";
import { VERSION } from "../index.js";
import { checkCommand } from "../commands/check.js";
import { lintCommand } from "../commands/lint.js";
import { buildCommand } from "../commands/build.js";
import { expandCommand } from "../commands/expand.js";
import { statsCommand } from "../commands/stats.js";
import { testCommand } from "../commands/test.js";
import { ddlCommand } from "../commands/ddl.js";
import { openapiCommand } from "../commands/openapi.js";
import { graphqlCommand } from "../commands/graphql.js";
import { mcpCommand } from "../commands/mcp.js";
import { uidlCommand } from "../commands/uidl.js";
import { devCommand } from "../commands/dev.js";
import { codegenCommand } from "../commands/codegen.js";
import { diffCommand } from "../commands/diff.js";
import { composeCommand } from "../commands/compose.js";
import { emitCommand } from "../commands/emit.js";
import { graphCommand } from "../commands/graph.js";
import { initCommand } from "../commands/init.js";
import { addCommand } from "../commands/add.js";
import { serveCommand } from "../commands/serve.js";
import { verifyCommand } from "../commands/verify.js";
import { decisionsExportCommand, decisionsImportCommand } from "../commands/decisions.js";
import { pkgCommand } from "../commands/pkg.js";

function printHelp(): void {
  console.log(`
Kerangka CLI v${VERSION}
One JSON skeleton. Every stack.

USAGE:
  kerangka <command> <file> [options]
  kerangka emit <target> <file> [options]

COMMANDS:
  init [template]         Scaffold a workspace or single-file starter (todo, invoicing, commerce, workspace)
  add <type> <name>       Generate files in standard structure (context, aggregate, action, policy, query, view)
  check <file>            Verify model syntax, references, and expressions
  lint <path>             Report boundaries, naming rules, and complexity budgets
  build <file>            Compile model into canonical KIR JSON
  pkg <subcommand>        Manage packages and lockfile (pkg lock | install | list)
  ddl <file>              Generate SQL DDL schema statements (PostgreSQL or SQLite)
  openapi <file>          Generate OpenAPI 3.1 specification JSON
  graphql <file>          Generate GraphQL Schema Definition Language (SDL)
  mcp <file>              Generate Model Context Protocol (MCP) tool declarations
  uidl <file>             Generate UIDL screen documents for UIDL-Runtime
  compose <file>          Generate production-ready Docker Compose infrastructure
  emit <target> <file>    Unified projector (compose, openapi, graphql, mcp, uidl, sql:*, types:*)
  dev <file>              Run zero-config dev server with REST, MCP, and UIDL playground
  serve <file>            Run production/sidecar server with REST and metadata endpoints
  verify <file>           Static analysis of workflows, permissions, decision tables, and events
  decisions <subcommand>  Import or export decision tables (decisions export | decisions import)
  codegen <file>          Generate typed models (TypeScript, Java 21, Python, Go)
  diff <file1> <file2>    Analyze structural and breaking changes between two model versions
  graph <file>            Draw the architecture / context map as Mermaid
  expand <file>           Display expanded entity models with resolved shorthands
  stats <file>            Display architectural metrics and complexity analysis
  test <file>             Execute declarative examples against the reference engine

OPTIONS:
  -d, --dialect <name>    SQL dialect for 'ddl' (postgres | sqlite, default: postgres)
  -t, --target <lang>     Target language for 'codegen' (ts | java | python | go, default: ts)
  --package <name>        Package namespace for generated Java or Go code
  --check-breaking        Exit with error code if breaking changes are detected in 'diff'
  --format <text|json>    Diagnostics format for 'check' and 'lint' (default: text)
  --preset <name>         Lint preset for 'lint' (kerangka:recommended | kerangka:off)
  --topology <name>       Deployment topology for 'lint' and 'graph'
  --direction <TD|LR>     Layout direction for 'graph' (default: TD)
  --context <name>        Target bounded context for 'add'
  --on <event>            Event trigger for 'add policy' (e.g. orders.OrderPlaced)
  --run <action>          Target action for 'add policy' (e.g. Invoice.create)
  --name <id>             Application name for 'init'
  --fail-on <severity>    Lowest severity that fails 'lint' (error | warning, default: error)
  -o, --output <path>     Output file or directory path (use '-' for stdout)
  -p, --port <number>     Port for dev server (default: 3000)
  --drop                  Include DROP TABLE IF EXISTS statements in DDL
  --no-audit              Exclude audit columns (created_at, updated_at, etc.) in DDL
  -h, --help              Show help information
  -v, --version           Show version information

EXAMPLES:
  kerangka check examples/invoicing.kerangka.json
  kerangka check examples/invoicing.kerangka.json --format json
  kerangka lint examples/invoicing.kerangka.json
  kerangka lint examples/commerce --topology distributed --fail-on warning
  kerangka build examples/invoicing.kerangka.json -o build/invoicing.kir.json
  kerangka codegen examples/invoicing.kerangka.json --target java -o InvoiceModel.java
  kerangka codegen examples/invoicing.kerangka.json --target python -o models.py
  kerangka diff old.json new.json --check-breaking
  kerangka graph examples/commerce
  kerangka graph examples/commerce --topology distributed
  kerangka dev examples/invoicing.kerangka.json --port 3000
`);
}

async function main(): Promise<void> {
  try {
    const { values, positionals } = parseArgs({
      args: process.argv.slice(2),
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean", short: "v" },
        output: { type: "string", short: "o" },
        dialect: { type: "string", short: "d" },
        target: { type: "string", short: "t" },
        package: { type: "string" },
        port: { type: "string", short: "p" },
        drop: { type: "boolean" },
        audit: { type: "boolean", default: true },
        "check-breaking": { type: "boolean" },
        format: { type: "string" },
        preset: { type: "string" },
        topology: { type: "string" },
        direction: { type: "string" },
        context: { type: "string" },
        on: { type: "string" },
        run: { type: "string" },
        name: { type: "string" },
        "fail-on": { type: "string" },
        from: { type: "string" },
        into: { type: "string" },
        "hit-policy": { type: "string" },
      },
      allowPositionals: true,
    });

    if (values.version) {
      console.log(`kerangka v${VERSION}`);
      process.exit(0);
    }

    if (values.help || positionals.length === 0) {
      printHelp();
      process.exit(0);
    }

    const command = positionals[0]!;
    const file = positionals[1];

    if (!file && command !== "help" && command !== "version" && command !== "init" && command !== "decisions" && command !== "pkg") {
      console.error(`Error: Missing argument for command '${command}'`);
      printHelp();
      process.exit(1);
    }

    let success = false;
    switch (command) {
      case "init": {
        success = initCommand(positionals[1], {
          output: values.output,
          name: values.name,
          format: values.format === "yaml" ? "yaml" : "json",
        });
        break;
      }
      case "add": {
        const type = positionals[1];
        const name = positionals[2];
        if (!type || !name) {
          console.error("Error: 'add' requires both a component type and a name: kerangka add <context|aggregate|action|policy|query|view> <name>");
          process.exit(1);
        }
        success = addCommand(type, name, {
          context: values.context,
          on: values.on,
          run: values.run,
          format: values.format === "yaml" ? "yaml" : "json",
        });
        break;
      }
      case "check": {
        const format = values.format ?? "text";
        if (format !== "text" && format !== "json") {
          console.error(`Error: --format must be 'text' or 'json', got '${format}'`);
          process.exit(1);
        }
        success = checkCommand(file!, { format });
        break;
      }
      case "lint": {
        const failOn = values["fail-on"] ?? "error";
        if (failOn !== "error" && failOn !== "warning") {
          console.error(`Error: --fail-on must be 'error' or 'warning', got '${failOn}'`);
          process.exit(1);
        }
        success = lintCommand(file!, {
          format: values.format === "json" ? "json" : "text",
          preset: values.preset,
          topology: values.topology,
          failOn,
        });
        break;
      }
      case "build":
        success = buildCommand(file!, values.output);
        break;
      case "ddl":
        success = ddlCommand(file!, {
          dialect: values.dialect,
          output: values.output,
          audit: values.audit,
          drop: values.drop,
        });
        break;
      case "openapi":
        success = openapiCommand(file!, values.output);
        break;
      case "graphql":
        success = graphqlCommand(file!, values.output);
        break;
      case "mcp":
        success = mcpCommand(file!, values.output);
        break;
      case "uidl":
        success = uidlCommand(file!, values.output);
        break;
      case "compose":
        success = composeCommand(file!, { output: values.output });
        break;
      case "emit": {
        const target = positionals[1];
        const targetFile = positionals[2];
        if (!target || !targetFile) {
          console.error("Error: 'emit' requires a target and file: kerangka emit <target> <file>");
          process.exit(1);
        }
        success = emitCommand(target, targetFile, {
          output: values.output,
          dialect: values.dialect,
          packageName: values.package,
        });
        break;
      }
      case "codegen":
        success = codegenCommand(file!, {
          target: values.target,
          output: values.output,
          packageName: values.package,
        });
        break;
      case "diff":
        const secondFile = positionals[2];
        if (!secondFile) {
          console.error("Error: 'diff' requires two model files to compare: kerangka diff <old> <new>");
          process.exit(1);
        }
        success = diffCommand(file!, secondFile, {
          checkBreaking: values["check-breaking"],
        });
        break;
      case "dev":
        success = await devCommand(file!, {
          port: values.port ? parseInt(values.port, 10) : 3000,
        });
        break;
      case "serve":
        success = await serveCommand(file!, {
          port: values.port ? parseInt(values.port, 10) : 3000,
        });
        break;
      case "verify":
        success = verifyCommand(file!, {
          format: values.format as "text" | "json",
        });
        break;
      case "decisions": {
        const sub = positionals[1];
        if (sub === "export") {
          const tableName = positionals[2];
          if (!tableName) {
            console.error("Error: 'decisions export' requires a table name: kerangka decisions export <tableName> --from <doc>");
            process.exit(1);
          }
          const fromDoc = values.from || positionals[3];
          if (!fromDoc) {
            console.error("Error: 'decisions export' requires a source document: --from <doc.json>");
            process.exit(1);
          }
          success = decisionsExportCommand(tableName, {
            from: fromDoc,
            output: values.output,
          });
        } else if (sub === "import") {
          const tableName = positionals[2];
          const csvFile = positionals[3];
          if (!tableName || !csvFile) {
            console.error("Error: 'decisions import' requires table name and CSV file: kerangka decisions import <tableName> <csvFile> --into <doc>");
            process.exit(1);
          }
          const intoDoc = values.into || positionals[4];
          if (!intoDoc) {
            console.error("Error: 'decisions import' requires a target document: --into <doc.json>");
            process.exit(1);
          }
          success = decisionsImportCommand(tableName, csvFile, {
            into: intoDoc,
            hitPolicy: values["hit-policy"] as "first" | "unique" | "collect" | "priority",
          });
        } else {
          console.error(`Error: Unknown decisions subcommand '${sub}'. Use 'export' or 'import'.`);
          process.exit(1);
        }
        break;
      }
      case "graph": {
        const format = values.format === "json" ? "json" : "mermaid";
        const direction = values.direction === "LR" ? "LR" : "TD";
        success = graphCommand(file!, {
          format,
          direction,
          output: values.output,
          topology: values.topology,
        });
        break;
      }
      case "expand":
        success = expandCommand(file!);
        break;
      case "pkg": {
        const sub = positionals[1] ?? "lock";
        const targetDoc = positionals[2];
        success = pkgCommand(sub, targetDoc, {
          output: values.output,
        });
        break;
      }
      case "stats":
        success = statsCommand(file!);
        break;
      case "test":
        success = testCommand(file!);
        break;
      default:
        console.error(`Error: Unknown command '${command}'`);
        printHelp();
        process.exit(1);
    }

    process.exit(success ? 0 : 1);
  } catch (err) {
    console.error(`Fatal error: ${(err as Error).message}`);
    process.exit(1);
  }
}

main();
