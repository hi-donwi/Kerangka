/**
 * Kerangka Built-in HTTP Connector
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

import { ConnectorHandler, ConnectorInvocation, ConnectorError, SSRFBlockedError } from "../connectors.js";
import { SecretsPort } from "../secrets.js";

export interface HttpConnectorOptions {
  /**
   * Hostnames/domains explicitly permitted.
   * Wildcards supported, e.g. ["api.example.com", "*.external.org"].
   */
  allowlist?: string[];

  /**
   * Block private/internal network ranges (SSRF protection).
   * Defaults to true.
   */
  blockPrivateRanges?: boolean;

  /**
   * Explicitly allow private IP ranges (for internal testing/dev only).
   * Defaults to false.
   */
  allowPrivateRanges?: boolean;

  /**
   * Default timeout in milliseconds for requests.
   * Defaults to 10000ms.
   */
  defaultTimeoutMs?: number;

  /**
   * Optional secrets port for resolving ${secret:KEY} placeholders.
   */
  secrets?: SecretsPort;

  /**
   * Custom fetch function (defaults to globalThis.fetch).
   */
  fetchFn?: typeof fetch;
}

export interface HttpRequestPayload {
  url?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";
  headers?: Record<string, string>;
  body?: unknown;
  input?: Record<string, unknown>;
  params?: Record<string, unknown>;
  query?: Record<string, string | number | boolean>;
  timeoutMs?: number;
}

export interface HttpResponseData<T = unknown> {
  ok: boolean;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  data: T;
  rawText?: string;
}

/**
 * Checks if an IPv4 address belongs to private, loopback, or link-local ranges.
 */
function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return false;
  }
  const [a, b] = parts;
  if (a === undefined || b === undefined) return false;
  // 0.0.0.0/8 (Current network)
  if (a === 0) return true;
  // 10.0.0.0/8 (Private)
  if (a === 10) return true;
  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;
  // 169.254.0.0/16 (Link-local / Cloud metadata)
  if (a === 169 && b === 254) return true;
  // 172.16.0.0/12 (Private)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16 (Private)
  if (a === 192 && b === 168) return true;
  // 100.64.0.0/10 (Carrier-grade NAT)
  if (a === 100 && b >= 64 && b <= 127) return true;
  // 255.255.255.255 (Broadcast)
  if (a === 255 && b === 255) return true;

  return false;
}

/**
 * Checks if a hostname or IP is a private/internal target.
 */
function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().trim();

  // Strip IPv6 brackets if present
  const cleanHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;

  if (
    cleanHost === "localhost" ||
    cleanHost === "localhost.localdomain" ||
    cleanHost.endsWith(".local") ||
    cleanHost.endsWith(".internal") ||
    cleanHost.endsWith(".lan") ||
    cleanHost.endsWith(".localhost")
  ) {
    return true;
  }

  // IPv6 loopback and private checks
  if (
    cleanHost === "::1" ||
    cleanHost === "0:0:0:0:0:0:0:1" ||
    cleanHost === "::" ||
    cleanHost.startsWith("fe80:") ||
    cleanHost.startsWith("fe9") ||
    cleanHost.startsWith("fea") ||
    cleanHost.startsWith("feb") ||
    cleanHost.startsWith("fc") ||
    cleanHost.startsWith("fd") ||
    cleanHost.startsWith("::ffff:127.") ||
    cleanHost.startsWith("::ffff:10.") ||
    cleanHost.startsWith("::ffff:192.168.") ||
    cleanHost.startsWith("::ffff:172.")
  ) {
    return true;
  }

  // IPv4 check
  if (isPrivateIPv4(cleanHost)) {
    return true;
  }

  return false;
}

/**
 * Checks if a host matches allowlist rules.
 */
function hostMatchesAllowlist(host: string, allowlist: string[]): boolean {
  const normalizedHost = host.toLowerCase();
  for (const pattern of allowlist) {
    const normPattern = pattern.toLowerCase();
    if (normPattern === normalizedHost) return true;
    if (normPattern.startsWith("*.")) {
      const suffix = normPattern.slice(1); // e.g. .example.com
      if (normalizedHost.endsWith(suffix) || normalizedHost === normPattern.slice(2)) {
        return true;
      }
    }
  }
  return false;
}

export class HttpConnector implements ConnectorHandler {
  readonly name = "http";
  private options: HttpConnectorOptions;

  constructor(options: HttpConnectorOptions = {}) {
    this.options = {
      blockPrivateRanges: true,
      allowPrivateRanges: false,
      defaultTimeoutMs: 10000,
      ...options,
    };
  }

  /**
   * Resolves secret and input placeholders in a string.
   */
  private async interpolateString(
    template: string,
    context?: Record<string, unknown>
  ): Promise<string> {
    // 1. Resolve ${secret:KEY}
    let result = template;
    const secretMatches = Array.from(template.matchAll(/\$\{secret:([^}]+)\}/g));
    for (const match of secretMatches) {
      const key = match[1];
      if (!key) continue;
      let val: string | null = null;
      if (this.options.secrets) {
        val = await this.options.secrets.getSecret(key);
      }
      if (val === null && typeof process !== "undefined" && process.env) {
        val = process.env[key] ?? null;
      }
      result = result.replaceAll(match[0], val ?? "");
    }

    // 2. Resolve ${input.foo} or ${params.foo} or ${foo}
    if (context) {
      const varMatches = Array.from(result.matchAll(/\$\{([^}]+)\}/g));
      for (const match of varMatches) {
        const fullExpr = match[0];
        const rawPath = match[1]?.trim();
        if (!rawPath || rawPath.startsWith("secret:")) continue;

        let val: unknown = this.resolvePath(context, rawPath);
        if (val === undefined && rawPath.startsWith("input.")) {
          val = this.resolvePath(context, rawPath.slice(6));
        } else if (val === undefined && rawPath.startsWith("payload.")) {
          val = this.resolvePath(context, rawPath.slice(8));
        } else if (val === undefined && !rawPath.includes(".")) {
          val =
            this.resolvePath(context, `input.${rawPath}`) ??
            this.resolvePath(context, `params.${rawPath}`);
        }

        if (val !== undefined && val !== null && val !== fullExpr) {
          result = result.replaceAll(fullExpr, String(val));
        }
      }
    }

    return result;
  }

  private resolvePath(obj: Record<string, unknown>, path: string): unknown {
    const parts = path.split(".");
    let curr: unknown = obj;
    for (const part of parts) {
      if (curr && typeof curr === "object" && part in curr) {
        curr = (curr as Record<string, unknown>)[part];
      } else {
        return undefined;
      }
    }
    return curr;
  }

  async call<T = unknown>(invocation: ConnectorInvocation): Promise<T> {
    const rawPayload = (invocation.payload || {}) as HttpRequestPayload;
    const operation = invocation.operation || "request";

    // Operation may be an HTTP method (get, post, etc.) or "request"
    const methodStr = (
      rawPayload.method ||
      (["get", "post", "put", "patch", "delete", "head", "options"].includes(operation.toLowerCase())
        ? operation
        : "GET")
    ).toUpperCase();

    const rawUrl = rawPayload.url || (typeof rawPayload === "string" ? rawPayload : "");
    if (!rawUrl) {
      throw new ConnectorError(
        "HTTP connector invocation requires a 'url' in payload.",
        this.name,
        operation,
        "INVALID_REQUEST"
      );
    }

    // Build context vars for interpolation
    const rawInput =
      rawPayload.input && typeof rawPayload.input === "object"
        ? (rawPayload.input as Record<string, unknown>)
        : {};
    const rawParams = rawPayload.params || {};

    const contextVars: Record<string, unknown> = {
      input: { ...rawInput, ...rawParams },
      params: rawParams,
      ...rawParams,
      ...rawInput,
      ...(invocation.metadata || {}),
    };

    const interpolatedUrl = await this.interpolateString(rawUrl, contextVars);

    // Validate URL
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(interpolatedUrl);
    } catch (err) {
      throw new ConnectorError(
        `Invalid URL for HTTP connector: '${interpolatedUrl}'`,
        this.name,
        operation,
        "INVALID_URL",
        err
      );
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new ConnectorError(
        `Protocol '${parsedUrl.protocol}' is forbidden in HTTP connector. Only http: and https: are supported.`,
        this.name,
        operation,
        "FORBIDDEN_PROTOCOL"
      );
    }

    // SSRF Validation
    const host = parsedUrl.hostname;
    const isPrivate = isPrivateHost(host);

    if (isPrivate && this.options.blockPrivateRanges && !this.options.allowPrivateRanges) {
      throw new SSRFBlockedError(
        `Access to private/internal network target '${host}' is blocked for security (SSRF protection).`,
        this.name,
        operation,
        host
      );
    }

    // Allowlist check if configured
    if (this.options.allowlist && this.options.allowlist.length > 0) {
      if (!hostMatchesAllowlist(host, this.options.allowlist)) {
        throw new ConnectorError(
          `Host '${host}' is not in the configured HTTP connector allowlist.`,
          this.name,
          operation,
          "HOST_NOT_ALLOWLISTED"
        );
      }
    }

    // Append query params if provided
    if (rawPayload.query) {
      for (const [k, v] of Object.entries(rawPayload.query)) {
        parsedUrl.searchParams.set(k, String(v));
      }
    }

    // Prepare headers with secret and param interpolation
    const requestHeaders: Record<string, string> = {};
    if (rawPayload.headers) {
      for (const [k, v] of Object.entries(rawPayload.headers)) {
        requestHeaders[k] = await this.interpolateString(v, contextVars);
      }
    }
    if (invocation.headers) {
      for (const [k, v] of Object.entries(invocation.headers)) {
        requestHeaders[k] = await this.interpolateString(v, contextVars);
      }
    }

    // Prepare body
    let requestBody: string | undefined = undefined;
    if (rawPayload.body !== undefined && !["GET", "HEAD"].includes(methodStr)) {
      if (typeof rawPayload.body === "string") {
        requestBody = await this.interpolateString(rawPayload.body, contextVars);
      } else {
        const serialized = JSON.stringify(rawPayload.body);
        requestBody = await this.interpolateString(serialized, contextVars);
        if (!requestHeaders["Content-Type"] && !requestHeaders["content-type"]) {
          requestHeaders["Content-Type"] = "application/json";
        }
      }
    }

    // Timeout & AbortController
    const timeoutMs = invocation.timeoutMs || rawPayload.timeoutMs || this.options.defaultTimeoutMs || 10000;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

    const fetchImpl = this.options.fetchFn || globalThis.fetch;
    if (!fetchImpl) {
      clearTimeout(timeoutHandle);
      throw new ConnectorError(
        "Fetch API is not available in the current runtime environment.",
        this.name,
        operation,
        "FETCH_UNAVAILABLE"
      );
    }

    try {
      const response = await fetchImpl(parsedUrl.toString(), {
        method: methodStr,
        headers: requestHeaders,
        body: requestBody,
        signal: controller.signal,
      });

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((v, k) => {
        responseHeaders[k] = v;
      });

      const contentType = response.headers.get("content-type") || "";
      const rawText = await response.text();

      let parsedData: unknown = rawText;
      if (contentType.includes("application/json") || contentType.includes("+json")) {
        try {
          parsedData = JSON.parse(rawText);
        } catch {
          parsedData = rawText;
        }
      }

      const resData: HttpResponseData<unknown> = {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: responseHeaders,
        data: parsedData,
        rawText,
      };

      if (!response.ok) {
        throw new ConnectorError(
          `HTTP ${methodStr} to ${parsedUrl.hostname} failed with status ${response.status}: ${response.statusText}`,
          this.name,
          operation,
          `HTTP_${response.status}`,
          resData
        );
      }

      return resData as T;
    } catch (err) {
      if (err instanceof ConnectorError) throw err;
      if (controller.signal.aborted) {
        throw new ConnectorError(
          `HTTP request to ${parsedUrl.hostname} timed out after ${timeoutMs}ms`,
          this.name,
          operation,
          "REQUEST_TIMEOUT",
          err
        );
      }
      throw new ConnectorError(
        `HTTP request to ${parsedUrl.hostname} failed: ${(err as Error).message}`,
        this.name,
        operation,
        "NETWORK_ERROR",
        err
      );
    } finally {
      clearTimeout(timeoutHandle);
    }
  }
}
