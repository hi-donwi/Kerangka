/**
 * Kerangka CLI - emit command
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { composeCommand, type ComposeCommandOptions } from "./compose.js";
import { openapiCommand } from "./openapi.js";
import { graphqlCommand } from "./graphql.js";
import { mcpCommand } from "./mcp.js";
import { uidlCommand } from "./uidl.js";
import { ddlCommand } from "./ddl.js";
import { codegenCommand } from "./codegen.js";
import type { TargetLanguage } from "@kerangka/compiler";

export interface EmitCommandOptions extends ComposeCommandOptions {
  dialect?: string;
  packageName?: string;
  target?: string;
}

export function emitCommand(
  target: string,
  filePath: string,
  options: EmitCommandOptions = {}
): boolean {
  switch (target) {
    case "compose":
      return composeCommand(filePath, options);

    case "openapi":
      return openapiCommand(filePath, options.output);

    case "graphql":
      return graphqlCommand(filePath, options.output);

    case "mcp":
      return mcpCommand(filePath, options.output);

    case "uidl":
      return uidlCommand(filePath, options.output);

    case "sql:postgres":
    case "postgres":
      return ddlCommand(filePath, {
        dialect: "postgres",
        output: options.output,
      });

    case "sql:sqlite":
    case "sqlite":
      return ddlCommand(filePath, {
        dialect: "sqlite",
        output: options.output,
      });

    case "types:ts":
    case "types:java":
    case "types:python":
    case "types:go": {
      const lang = target.split(":")[1] as TargetLanguage;
      return codegenCommand(filePath, {
        target: lang,
        output: options.output,
        packageName: options.packageName,
      });
    }

    default:
      console.error(
        `Error: Unsupported emit target '${target}'. Supported targets: compose, openapi, graphql, mcp, uidl, sql:postgres, sql:sqlite, types:ts, types:java, types:python, types:go`
      );
      return false;
  }
}
