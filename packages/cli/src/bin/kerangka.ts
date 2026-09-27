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

function printHelp(): void {
  console.log(`
Kerangka CLI v${VERSION}
One JSON skeleton. Every stack.

USAGE:
  kerangka <command> <file> [options]
  kerangka emit <target> <file> [options]

COMMANDS:
  check <file>            Verify model syntax, references, and expressions
  build <file>            Compile model into canonical KIR JSON
  ddl <file>              Generate SQL DDL schema statements (PostgreSQL or SQLite)
  openapi <file>          Generate OpenAPI 3.1 specification JSON
  graphql <file>          Generate GraphQL Schema Definition Language (SDL)
  mcp <file>              Generate Model Context Protocol (MCP) tool declarations
  uidl <file>             Generate UIDL screen documents for UIDL-Runtime
  compose <file>          Generate production-ready Docker Compose infrastructure
  emit <target> <file>    Unified projector (compose, openapi, graphql, mcp, uidl, sql:*, types:*)
  dev <file>              Run zero-config dev server with REST, MCP, and UIDL playground
  codegen <file>          Generate typed models (TypeScript, Java 21, Python, Go)
  diff <file1> <file2>    Analyze structural and breaking changes between two model versions
  expand <file>           Display expanded entity models with resolved shorthands
  stats <file>            Display architectural metrics and complexity analysis
  test <file>             Execute declarative examples against the reference engine

OPTIONS:
  -d, --dialect <name>    SQL dialect for 'ddl' (postgres | sqlite, default: postgres)
  -t, --target <lang>     Target language for 'codegen' (ts | java | python | go, default: ts)
  --package <name>        Package namespace for generated Java or Go code
  --check-breaking        Exit with error code if breaking changes are detected in 'diff'
  -o, --output <path>     Output file or directory path (use '-' for stdout)
  -p, --port <number>     Port for dev server (default: 3000)
  --drop                  Include DROP TABLE IF EXISTS statements in DDL
  --no-audit              Exclude audit columns (created_at, updated_at, etc.) in DDL
  -h, --help              Show help information
  -v, --version           Show version information

EXAMPLES:
  kerangka check examples/invoicing.kerangka.json
  kerangka build examples/invoicing.kerangka.json -o build/invoicing.kir.json
  kerangka codegen examples/invoicing.kerangka.json --target java -o InvoiceModel.java
  kerangka codegen examples/invoicing.kerangka.json --target python -o models.py
  kerangka diff old.json new.json --check-breaking
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

    if (!file && command !== "help" && command !== "version") {
      console.error(`Error: Missing file argument for command '${command}'`);
      printHelp();
      process.exit(1);
    }

    let success = false;
    switch (command) {
      case "check":
        success = checkCommand(file!);
        break;
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
      case "expand":
        success = expandCommand(file!);
        break;
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
