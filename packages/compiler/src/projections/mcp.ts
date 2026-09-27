/**
 * Kerangka Model Context Protocol (MCP) Projection Generator
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { FieldDefinition, KIRDocument } from "../types.js";

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export class McpGenerator {
  static generate(kir: KIRDocument): McpToolDefinition[] {
    const tools: McpToolDefinition[] = [];

    for (const [entityName, entity] of Object.entries(kir.entities || {})) {
      if (entity.embedded) continue;

      const lower = entityName.toLowerCase();
      const entityProps: Record<string, unknown> = {};
      const requiredProps: string[] = [];

      for (const [fieldName, field] of Object.entries(entity.fields)) {
        if (!field.compute) {
          entityProps[fieldName] = this.mapFieldToJsonSchema(field);
          if (field.required && field.default === undefined && fieldName !== entity.key) {
            requiredProps.push(fieldName);
          }
        }
      }

      // 1. List tool
      tools.push({
        name: `list_${lower}`,
        description: `List and query ${entityName} records with optional filtering and pagination.`,
        inputSchema: {
          type: "object",
          properties: {
            limit: { type: "integer", description: "Maximum number of records to return (default: 50)" },
            offset: { type: "integer", description: "Number of records to skip" },
            sort: { type: "string", description: "Sort field and order (e.g. 'createdAt:desc')" },
            filter: {
              type: "object",
              description: `Filters to apply to ${entityName} records`,
              properties: entityProps
            }
          }
        }
      });

      // 2. Get tool
      tools.push({
        name: `get_${lower}`,
        description: `Retrieve a single ${entityName} record by its identifier.`,
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: `Primary key / ID of the ${entityName}` }
          },
          required: ["id"]
        }
      });

      // 3. Create tool
      tools.push({
        name: `create_${lower}`,
        description: `Create a new ${entityName} record.`,
        inputSchema: {
          type: "object",
          properties: entityProps,
          required: requiredProps.length > 0 ? requiredProps : undefined
        }
      });

      // 4. Update tool
      tools.push({
        name: `update_${lower}`,
        description: `Update fields of an existing ${entityName} record.`,
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: `Primary key / ID of the ${entityName} to update` },
            patch: {
              type: "object",
              description: `Field values to update on the ${entityName}`,
              properties: entityProps
            }
          },
          required: ["id", "patch"]
        }
      });

      // 5. Delete tool
      tools.push({
        name: `delete_${lower}`,
        description: `Delete a ${entityName} record by ID.`,
        inputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: `Primary key / ID of the ${entityName} to delete` }
          },
          required: ["id"]
        }
      });

      // 6. Workflow transitions
      if (entity.workflow?.transitions) {
        for (const [actionName, transition] of Object.entries(entity.workflow.transitions)) {
          const fromStates = Array.isArray(transition.from) ? transition.from.join(", ") : transition.from;
          tools.push({
            name: `transition_${lower}_${actionName}`,
            description: `Execute workflow transition '${actionName}' on ${entityName} (moves from ${fromStates} to ${transition.to}).`,
            inputSchema: {
              type: "object",
              properties: {
                id: { type: "string", description: `Primary key / ID of the ${entityName}` },
                reason: { type: "string", description: "Optional audit reason for this state transition" }
              },
              required: ["id"]
            }
          });
        }
      }

      // 7. Custom actions
      if (entity.actions) {
        for (const [actionName, action] of Object.entries(entity.actions)) {
          const actionInputProps: Record<string, unknown> = {};
          const actionRequired: string[] = [];

          if (action.input) {
            for (const [fieldName, field] of Object.entries(action.input)) {
              actionInputProps[fieldName] = this.mapFieldToJsonSchema(field);
              if (field.required) actionRequired.push(fieldName);
            }
          }

          tools.push({
            name: `action_${lower}_${actionName}`,
            description: `Execute custom action '${actionName}' on ${entityName}.`,
            inputSchema: {
              type: "object",
              properties: {
                id: { type: "string", description: `Primary key / ID of the ${entityName}` },
                input: {
                  type: "object",
                  description: "Arguments for the action",
                  properties: actionInputProps,
                  required: actionRequired.length > 0 ? actionRequired : undefined
                }
              },
              required: ["id"]
            }
          });
        }
      }
    }

    return tools;
  }

  private static mapFieldToJsonSchema(field: FieldDefinition): Record<string, unknown> {
    const schema: Record<string, unknown> = {};

    switch (field.type) {
      case "string":
      case "email":
      case "date":
      case "datetime":
      case "time":
        schema.type = "string";
        break;
      case "int":
      case "integer":
        schema.type = "integer";
        break;
      case "float":
      case "decimal":
        schema.type = "number";
        break;
      case "boolean":
      case "bool":
        schema.type = "boolean";
        break;
      case "enum":
        schema.type = "string";
        if (field.values) schema.enum = field.values;
        break;
      case "ref":
        schema.type = "string";
        schema.description = `Reference ID to ${field.target || "entity"}`;
        break;
      case "list":
        schema.type = "array";
        if (field.element) {
          schema.items = this.mapFieldToJsonSchema(field.element);
        } else {
          schema.items = {};
        }
        break;
      default:
        schema.type = "string";
    }

    if (field.description) schema.description = field.description;
    return schema;
  }
}
