export interface OpenApiContextField {
  name: string;
  type: string;
  required: boolean;
}

export interface OpenApiEndpointSummary {
  method: string;
  path: string;
  operationId?: string;
  entityName?: string;
  actionName?: string;
  requestBodyRequired?: boolean;
  requestFields: OpenApiContextField[];
  notes: string[];
}

type JsonObject = Record<string, unknown>;

const methods = ["get", "post", "put", "patch", "delete", "head", "options", "trace"] as const;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length ? value : undefined;
}

function resolveLocalReference(document: JsonObject, value: unknown): unknown {
  if (!isRecord(value) || typeof value.$ref !== "string" || !value.$ref.startsWith("#/")) return value;
  const parts = value.$ref.slice(2).split("/").map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"));
  let current: unknown = document;
  for (const part of parts) {
    if (!isRecord(current)) return value;
    current = current[part];
  }
  return current;
}

function schemaName(schema: unknown): string | undefined {
  if (!isRecord(schema) || typeof schema.$ref !== "string") return undefined;
  const parts = schema.$ref.split("/");
  return parts.at(-1)?.replaceAll("~1", "/").replaceAll("~0", "~");
}

function schemaType(schema: unknown): string {
  if (!isRecord(schema)) return "unknown";
  const ref = schemaName(schema);
  if (ref) return ref;
  const type = text(schema.type);
  if (type === "array") return `array<${schemaType(schema.items)}>`;
  if (type) return type;
  if (isRecord(schema.properties)) return "object";
  return "unknown";
}

function objectFields(document: JsonObject, schema: unknown): OpenApiContextField[] {
  const resolved = resolveLocalReference(document, schema);
  if (!isRecord(resolved)) return [];
  const properties = isRecord(resolved.properties) ? resolved.properties : undefined;
  if (!properties) return [];
  const required = new Set(Array.isArray(resolved.required)
    ? resolved.required.filter((field): field is string => typeof field === "string")
    : []);
  return Object.entries(properties).flatMap(([name, field]) => isRecord(field)
    ? [{ name, type: schemaType(field), required: required.has(name) }]
    : []);
}

function compactFields(fields: OpenApiContextField[]): string {
  const shown = fields.slice(0, 12).map((field) =>
    `${field.name}: ${field.type}${field.required ? " [required]" : ""}`,
  );
  if (fields.length > shown.length) shown.push(`+${fields.length - shown.length} fields`);
  return shown.join(", ");
}

function mediaSchema(document: JsonObject, value: unknown): { mediaType: string; schema?: unknown } | undefined {
  const resolved = resolveLocalReference(document, value);
  if (!isRecord(resolved) || !isRecord(resolved.content)) return undefined;
  const mediaType = ["application/json", "application/problem+json", "text/event-stream"]
    .find((candidate) => isRecord(resolved.content) && Object.hasOwn(resolved.content, candidate))
    ?? Object.keys(resolved.content)[0];
  if (!mediaType) return undefined;
  const media = resolved.content[mediaType];
  return { mediaType, ...(isRecord(media) && media.schema !== undefined ? { schema: media.schema } : {}) };
}

function responseNotes(document: JsonObject, responses: unknown): string[] {
  if (!isRecord(responses)) return [];
  return Object.entries(responses)
    .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
    .slice(0, 8)
    .map(([status, value]) => {
      const media = mediaSchema(document, value);
      if (!media?.schema) return `Response ${status}: ${media?.mediaType ?? "no body"}`;
      const type = schemaType(media.schema);
      const itemSchema = isRecord(media.schema) && media.schema.type === "array" ? media.schema.items : media.schema;
      const fields = objectFields(document, itemSchema);
      const shape = fields.length ? `${type} (${compactFields(fields)})` : type;
      return `Response ${status}: ${shape}${media.mediaType !== "application/json" ? `, ${media.mediaType}` : ""}`;
    });
}

function parameterNotes(pathParameters: unknown, operationParameters: unknown, document: JsonObject): string[] {
  const parameters = [
    ...(Array.isArray(pathParameters) ? pathParameters : []),
    ...(Array.isArray(operationParameters) ? operationParameters : []),
  ].map((parameter) => resolveLocalReference(document, parameter)).filter(isRecord);
  const unique = new Map<string, string>();
  for (const parameter of parameters) {
    const name = text(parameter.name);
    const location = text(parameter.in);
    if (!name || !location) continue;
    unique.set(`${location}:${name}`, `${name} (${location}, ${schemaType(parameter.schema)})`);
  }
  const entries = [...unique.values()];
  return entries.length ? [`Parameters: ${entries.join(", ")}`] : [];
}

function entityFor(operation: JsonObject, path: string, entityNames: Set<string>): string | undefined {
  const tags = Array.isArray(operation.tags) ? operation.tags.filter((tag): tag is string => typeof tag === "string") : [];
  const taggedEntity = tags.find((tag) => entityNames.has(tag));
  if (taggedEntity) return taggedEntity;
  const firstSegment = /^\/api\/([^/]+)/i.exec(path)?.[1];
  return [...entityNames].find((name) => name.toLowerCase() === firstSegment?.toLowerCase());
}

/** Extract only structural metadata; never copy OpenAPI descriptions, examples, or raw documents. */
export function summarizeOpenApi(openApiText: string, entityNames: Set<string>): OpenApiEndpointSummary[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(openApiText);
  } catch {
    return [];
  }
  if (!isRecord(parsed) || !isRecord(parsed.paths)) return [];
  const endpoints: OpenApiEndpointSummary[] = [];
  for (const [path, pathItem] of Object.entries(parsed.paths)) {
    if (!isRecord(pathItem)) continue;
    for (const method of methods) {
      const operation = pathItem[method];
      if (!isRecord(operation)) continue;
      const entityName = entityFor(operation, path, entityNames);
      const actionName = /\/actions\/([^/]+)$/.exec(path)?.[1];
      const operationId = text(operation.operationId);
      const request = resolveLocalReference(parsed, operation.requestBody);
      const requestMedia = mediaSchema(parsed, request);
      const requestFields = requestMedia?.schema ? objectFields(parsed, requestMedia.schema) : [];
      const notes = [
        `Endpoint: ${method.toUpperCase()} ${path}`,
        ...(operationId ? [`Operation: ${operationId}`] : []),
        ...parameterNotes(pathItem.parameters, operation.parameters, parsed),
        ...(requestMedia?.schema
          ? [`Request body: ${isRecord(request) && request.required === true ? "required" : "optional"}`]
          : []),
        ...(requestMedia?.schema
          ? [`Request: ${schemaName(requestMedia.schema) ?? schemaType(requestMedia.schema)}${requestFields.length ? ` (${compactFields(requestFields)})` : ""}`]
          : []),
        ...responseNotes(parsed, operation.responses),
      ];
      endpoints.push({
        method,
        path,
        ...(operationId ? { operationId } : {}),
        ...(entityName ? { entityName } : {}),
        ...(actionName ? { actionName } : {}),
        ...(requestMedia?.schema ? { requestBodyRequired: isRecord(request) && request.required === true } : {}),
        requestFields,
        notes,
      });
    }
  }
  return endpoints.sort((left, right) =>
    left.path.localeCompare(right.path) || left.method.localeCompare(right.method),
  );
}
