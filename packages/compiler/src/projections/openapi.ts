/**
 * Kerangka OpenAPI 3.1 Projection Generator
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { embeddedTargetsOf, toJsonSchemaField } from "./json-schema-field.js";
import { FieldDefinition, KIRDocument } from "../types.js";

export interface OpenAPIOptions {
  serverUrl?: string;
  apiVersion?: string;
}

export class OpenAPIGenerator {
  static generate(kir: KIRDocument, options: OpenAPIOptions = {}): Record<string, unknown> {
    const title = kir.meta?.title || kir.app;
    const version = options.apiVersion || kir.meta?.version || "1.0.0";
    const serverUrl = options.serverUrl || "http://localhost:3000";

    // One mapping, shared with every JSON-shaped projection: the only thing this
    // document supplies is where its `$ref` pointers point.
    const embeddedTargets = embeddedTargetsOf(
      (kir.entities ?? {}) as Record<string, { embedded?: boolean }>
    );
    const fieldSchema = (field: FieldDefinition): Record<string, unknown> =>
      toJsonSchemaField(field, { refBase: "#/components/schemas", embeddedTargets });

    const schemas: Record<string, unknown> = {
      ProblemDetails: {
        type: "object",
        description: "RFC 9457 Problem Details for HTTP APIs",
        required: ["title", "status"],
        properties: {
          type: { type: "string", format: "uri", default: "about:blank" },
          title: { type: "string", description: "Human-readable summary of problem" },
          status: { type: "integer", description: "HTTP status code" },
          detail: { type: "string", description: "Human-readable explanation of error" },
          instance: { type: "string", format: "uri", description: "URI of specific occurrence" },
          code: { type: "string", description: "Stable machine-readable error code" },
          invalidParams: {
            type: "array",
            items: {
              type: "object",
              required: ["name", "reason"],
              properties: {
                name: { type: "string" },
                reason: { type: "string" }
              }
            }
          }
        }
      }
    };

    const paths: Record<string, unknown> = {};

    for (const [entityName, entity] of Object.entries(kir.entities || {})) {
      // Build Entity schema
      const entityProperties: Record<string, unknown> = {};
      const requiredFields: string[] = [];
      const createProperties: Record<string, unknown> = {};
      const createRequired: string[] = [];

      for (const [fieldName, field] of Object.entries(entity.fields)) {
        const propSchema = fieldSchema(field);
        entityProperties[fieldName] = propSchema;

        if (field.required) {
          requiredFields.push(fieldName);
        }

        // Exclude computed fields from create request
        if (!field.compute) {
          createProperties[fieldName] = propSchema;
          if (field.required && field.default === undefined && fieldName !== entity.key) {
            createRequired.push(fieldName);
          }
        }
      }

      schemas[entityName] = {
        type: "object",
        description: `${entityName} entity`,
        properties: entityProperties,
        required: requiredFields.length > 0 ? requiredFields : undefined
      };

      if (!entity.embedded) {
        schemas[`Create${entityName}Request`] = {
          type: "object",
          description: `Payload for creating a new ${entityName}`,
          properties: createProperties,
          required: createRequired.length > 0 ? createRequired : undefined
        };

        schemas[`Update${entityName}Request`] = {
          type: "object",
          description: `Payload for updating an existing ${entityName}`,
          properties: createProperties
        };

        const pathKey = `/api/${entityName.toLowerCase()}`;
        const itemPathKey = `/api/${entityName.toLowerCase()}/{id}`;

        // Collection endpoints
        paths[pathKey] = {
          get: {
            summary: `List ${entityName} records`,
            operationId: `list${entityName}`,
            tags: [entityName],
            parameters: [
              { name: "limit", in: "query", schema: { type: "integer", default: 50 }, description: "Max records to return" },
              { name: "offset", in: "query", schema: { type: "integer", default: 0 }, description: "Number of records to skip" },
              { name: "sort", in: "query", schema: { type: "string" }, description: "Sort field and direction (e.g. createdAt:desc)" }
            ],
            responses: {
              "200": {
                description: `List of ${entityName} items`,
                content: {
                  "application/json": {
                    schema: {
                      type: "array",
                      items: { $ref: `#/components/schemas/${entityName}` }
                    }
                  }
                }
              },
              "400": { $ref: "#/components/responses/ProblemResponse" },
              "401": { $ref: "#/components/responses/ProblemResponse" },
              "403": { $ref: "#/components/responses/ProblemResponse" }
            }
          },
          post: {
            summary: `Create a new ${entityName}`,
            operationId: `create${entityName}`,
            tags: [entityName],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: `#/components/schemas/Create${entityName}Request` }
                }
              }
            },
            responses: {
              "201": {
                description: `${entityName} successfully created`,
                content: {
                  "application/json": {
                    schema: { $ref: `#/components/schemas/${entityName}` }
                  }
                }
              },
              "400": { $ref: "#/components/responses/ProblemResponse" },
              "401": { $ref: "#/components/responses/ProblemResponse" },
              "403": { $ref: "#/components/responses/ProblemResponse" }
            }
          }
        };

        // Item endpoints
        paths[itemPathKey] = {
          parameters: [
            {
              name: "id",
              in: "path",
              required: true,
              schema: { type: "string" },
              description: `Primary key of the ${entityName}`
            }
          ],
          get: {
            summary: `Get ${entityName} by ID`,
            operationId: `get${entityName}`,
            tags: [entityName],
            responses: {
              "200": {
                description: `${entityName} details`,
                content: {
                  "application/json": {
                    schema: { $ref: `#/components/schemas/${entityName}` }
                  }
                }
              },
              "404": { $ref: "#/components/responses/ProblemResponse" }
            }
          },
          put: {
            summary: `Update ${entityName}`,
            operationId: `update${entityName}`,
            tags: [entityName],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: { $ref: `#/components/schemas/Update${entityName}Request` }
                }
              }
            },
            responses: {
              "200": {
                description: `${entityName} updated`,
                content: {
                  "application/json": {
                    schema: { $ref: `#/components/schemas/${entityName}` }
                  }
                }
              },
              "400": { $ref: "#/components/responses/ProblemResponse" },
              "404": { $ref: "#/components/responses/ProblemResponse" }
            }
          },
          delete: {
            summary: `Delete ${entityName}`,
            operationId: `delete${entityName}`,
            tags: [entityName],
            responses: {
              "204": { description: `${entityName} deleted successfully` },
              "404": { $ref: "#/components/responses/ProblemResponse" }
            }
          }
        };

        // Workflow transition endpoints
        if (entity.workflow?.transitions) {
          for (const [actionName, transition] of Object.entries(entity.workflow.transitions)) {
            const actionPath = `/api/${entityName.toLowerCase()}/{id}/actions/${actionName}`;
            paths[actionPath] = {
              parameters: [
                {
                  name: "id",
                  in: "path",
                  required: true,
                  schema: { type: "string" },
                  description: `Primary key of the ${entityName}`
                }
              ],
              post: {
                summary: `Execute ${actionName} transition on ${entityName}`,
                description: `Transitions ${entityName} from ${Array.isArray(transition.from) ? transition.from.join(", ") : transition.from} to ${transition.to}.`,
                operationId: `${entityName.toLowerCase()}_${actionName}`,
                tags: [entityName],
                responses: {
                  "200": {
                    description: `Transition executed successfully`,
                    content: {
                      "application/json": {
                        schema: { $ref: `#/components/schemas/${entityName}` }
                      }
                    }
                  },
                  "400": { $ref: "#/components/responses/ProblemResponse" },
                  "403": { $ref: "#/components/responses/ProblemResponse" },
                  "404": { $ref: "#/components/responses/ProblemResponse" }
                }
              }
            };
          }
        }

        // Custom action endpoints
        if (entity.actions) {
          for (const [actionName, action] of Object.entries(entity.actions)) {
            const actionPath = `/api/${entityName.toLowerCase()}/{id}/actions/${actionName}`;
            const actionInputSchema: Record<string, unknown> = {};
            if (action.input) {
              for (const [fieldName, field] of Object.entries(action.input)) {
                actionInputSchema[fieldName] = fieldSchema(field);
              }
            }

            paths[actionPath] = {
              parameters: [
                {
                  name: "id",
                  in: "path",
                  required: true,
                  schema: { type: "string" },
                  description: `Primary key of the ${entityName}`
                }
              ],
              post: {
                summary: `Execute custom action ${actionName} on ${entityName}`,
                operationId: `${entityName.toLowerCase()}_action_${actionName}`,
                tags: [entityName],
                requestBody: action.input && Object.keys(action.input).length > 0 ? {
                  required: true,
                  content: {
                    "application/json": {
                      schema: {
                        type: "object",
                        properties: actionInputSchema
                      }
                    }
                  }
                } : undefined,
                responses: {
                  "200": {
                    description: `Action ${actionName} completed`,
                    content: {
                      "application/json": {
                        schema: { $ref: `#/components/schemas/${entityName}` }
                      }
                    }
                  },
                  "400": { $ref: "#/components/responses/ProblemResponse" },
                  "403": { $ref: "#/components/responses/ProblemResponse" }
                }
              }
            };
          }
        }
      }
    }

    return {
      openapi: "3.1.0",
      info: {
        title,
        version,
        description: kir.meta?.description || `REST API generated by Kerangka from declarative model ${kir.app}.`
      },
      servers: [
        { url: serverUrl, description: "API Server" }
      ],
      paths,
      components: {
        schemas,
        responses: {
          ProblemResponse: {
            description: "Error response following RFC 9457",
            content: {
              "application/problem+json": {
                schema: { $ref: "#/components/schemas/ProblemDetails" }
              }
            }
          }
        },
        securitySchemes: {
          BearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "Provide JWT bearer token with assigned user roles."
          }
        }
      }
    };
  }
}
