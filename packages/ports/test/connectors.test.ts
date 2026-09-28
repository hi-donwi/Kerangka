import { describe, expect, it } from "vitest";
import {
  DefaultConnectors,
  HttpConnector,
  SequenceConnector,
  EmailConnector,
  MemoryEmailTransport,
  MemorySecrets,
  EnvSecrets,
  MemoryStore,
  ConnectorError,
  SSRFBlockedError,
} from "../src/index.js";
import { createConnectorsTestKit } from "../src/test-kits/index.js";

describe("ConnectorsPort & Standard Built-in Connectors", () => {
  // Port Certification Test Kit
  createConnectorsTestKit("DefaultConnectors", () => new DefaultConnectors());

  describe("Secrets Providers", () => {
    it("MemorySecrets sets, gets, and deletes secrets", async () => {
      const secrets = new MemorySecrets({ INITIAL_KEY: "secret123" });
      expect(await secrets.getSecret("INITIAL_KEY")).toBe("secret123");
      expect(await secrets.getSecret("UNKNOWN")).toBeNull();

      secrets.setSecret("API_TOKEN", "tok_xyz");
      expect(await secrets.getSecret("API_TOKEN")).toBe("tok_xyz");

      secrets.deleteSecret("INITIAL_KEY");
      expect(await secrets.getSecret("INITIAL_KEY")).toBeNull();
    });

    it("EnvSecrets retrieves environment variables with optional prefix", async () => {
      process.env.TEST_KERANGKA_VAR = "hello_env";
      process.env.APP_SECRET_KEY = "vault_abc";

      const env1 = new EnvSecrets();
      expect(await env1.getSecret("TEST_KERANGKA_VAR")).toBe("hello_env");

      const envPrefixed = new EnvSecrets("APP_");
      expect(await envPrefixed.getSecret("SECRET_KEY")).toBe("vault_abc");
    });
  });

  describe("HttpConnector & SSRF Protection", () => {
    it("blocks private IPv4 addresses (SSRF protection)", async () => {
      const http = new HttpConnector();

      // Loopback
      await expect(
        http.call({
          connector: "http",
          operation: "get",
          payload: { url: "http://127.0.0.1:8080/admin" },
        })
      ).rejects.toThrowError(SSRFBlockedError);

      // RFC 1918 10.0.0.0/8
      await expect(
        http.call({
          connector: "http",
          operation: "get",
          payload: { url: "http://10.0.0.5/secrets" },
        })
      ).rejects.toThrowError(SSRFBlockedError);

      // RFC 1918 172.16.0.0/12
      await expect(
        http.call({
          connector: "http",
          operation: "get",
          payload: { url: "http://172.20.1.1/internal" },
        })
      ).rejects.toThrowError(SSRFBlockedError);

      // RFC 1918 192.168.0.0/16
      await expect(
        http.call({
          connector: "http",
          operation: "get",
          payload: { url: "http://192.168.1.1/router" },
        })
      ).rejects.toThrowError(SSRFBlockedError);

      // Link-local / Cloud metadata (AWS 169.254.169.254)
      await expect(
        http.call({
          connector: "http",
          operation: "get",
          payload: { url: "http://169.254.169.254/latest/meta-data/" },
        })
      ).rejects.toThrowError(SSRFBlockedError);

      // Localhost hostname
      await expect(
        http.call({
          connector: "http",
          operation: "get",
          payload: { url: "http://localhost:3000/api" },
        })
      ).rejects.toThrowError(SSRFBlockedError);
    });

    it("blocks forbidden protocols such as file: or ftp:", async () => {
      const http = new HttpConnector();
      await expect(
        http.call({
          connector: "http",
          operation: "get",
          payload: { url: "file:///etc/passwd" },
        })
      ).rejects.toThrowError(ConnectorError);
    });

    it("enforces host allowlist when configured", async () => {
      const http = new HttpConnector({
        allowlist: ["api.example.com", "*.partner.org"],
      });

      // Disallowed external host
      await expect(
        http.call({
          connector: "http",
          operation: "get",
          payload: { url: "https://evil.attacker.com/data" },
        })
      ).rejects.toThrowError(/not in the configured HTTP connector allowlist/);
    });

    it("dispatches requests with secret and parameter interpolation", async () => {
      const secrets = new MemorySecrets({
        EXCHANGE_TOKEN: "tok_secret_999",
      });

      let capturedUrl = "";
      let capturedHeaders: Record<string, string> = {};
      let capturedBody = "";
      let capturedMethod = "";

      const mockFetch: typeof fetch = async (input, init) => {
        capturedUrl = String(input);
        capturedMethod = init?.method || "GET";
        capturedHeaders = (init?.headers as Record<string, string>) || {};
        capturedBody = String(init?.body || "");

        return new Response(JSON.stringify({ rate: 1.085, base: "EUR" }), {
          status: 200,
          statusText: "OK",
          headers: { "Content-Type": "application/json" },
        });
      };

      const http = new HttpConnector({
        secrets,
        fetchFn: mockFetch,
        allowlist: ["api.example.com"],
      });

      // Call connector
      const res = await http.call<{ data: { rate: number; base: string } }>({
        connector: "http",
        operation: "post",
        payload: {
          url: "https://api.example.com/rates/${currency}",
          headers: {
            Authorization: "Bearer ${secret:EXCHANGE_TOKEN}",
          },
          body: { currency: "${currency}", amount: 100 },
          params: { currency: "USD" },
        },
      });

      expect(capturedUrl).toBe("https://api.example.com/rates/USD");
      expect(capturedMethod).toBe("POST");
      expect(capturedHeaders["Authorization"]).toBe("Bearer tok_secret_999");
      expect(capturedHeaders["Content-Type"]).toBe("application/json");
      expect(JSON.parse(capturedBody)).toEqual({ currency: "USD", amount: 100 });

      expect(res.data).toEqual({ rate: 1.085, base: "EUR" });
    });
  });

  describe("SequenceConnector", () => {
    it("generates monotonic formatted sequences", async () => {
      const sequence = new SequenceConnector();

      const res1 = await sequence.call<{ sequence: string; value: number }>({
        connector: "sequence",
        operation: "next",
        payload: {
          name: "invoice_seq",
          pattern: "INV-${YYYY}-${seq:05}",
          start: 1,
          date: "2026-09-28T00:00:00Z",
        },
      });
      expect(res1.sequence).toBe("INV-2026-00001");
      expect(res1.value).toBe(1);

      const res2 = await sequence.call<{ sequence: string; value: number }>({
        connector: "sequence",
        operation: "next",
        payload: {
          name: "invoice_seq",
          pattern: "INV-${YYYY}-${seq:05}",
          date: "2026-09-28T00:00:00Z",
        },
      });
      expect(res2.sequence).toBe("INV-2026-00002");
      expect(res2.value).toBe(2);

      // Check current
      const curr = await sequence.call<{ sequence: string; value: number }>({
        connector: "sequence",
        operation: "current",
        payload: {
          name: "invoice_seq",
          pattern: "INV-${YYYY}-${seq:05}",
          date: "2026-09-28T00:00:00Z",
        },
      });
      expect(curr.sequence).toBe("INV-2026-00002");
      expect(curr.value).toBe(2);

      // Reset
      const resetRes = await sequence.call<{ sequence: string; value: number }>({
        connector: "sequence",
        operation: "reset",
        payload: {
          name: "invoice_seq",
          pattern: "INV-${YYYY}-${seq:05}",
          start: 100,
          date: "2026-09-28T00:00:00Z",
        },
      });
      expect(resetRes.sequence).toBe("INV-2026-00100");
      expect(resetRes.value).toBe(100);
    });

    it("isolates sequences across tenants", async () => {
      const sequence = new SequenceConnector();

      const t1 = await sequence.call<{ sequence: string; value: number }>({
        connector: "sequence",
        operation: "next",
        payload: { name: "order_num", pattern: "ORD-${seq:4}", tenantId: "tenant_alpha" },
      });
      expect(t1.sequence).toBe("ORD-0001");

      const t2 = await sequence.call<{ sequence: string; value: number }>({
        connector: "sequence",
        operation: "next",
        payload: { name: "order_num", pattern: "ORD-${seq:4}", tenantId: "tenant_beta" },
      });
      expect(t2.sequence).toBe("ORD-0001");

      const t1_next = await sequence.call<{ sequence: string; value: number }>({
        connector: "sequence",
        operation: "next",
        payload: { name: "order_num", pattern: "ORD-${seq:4}", tenantId: "tenant_alpha" },
      });
      expect(t1_next.sequence).toBe("ORD-0002");
    });

    it("persists state in StorePort when provided", async () => {
      const store = new MemoryStore();
      const sequence = new SequenceConnector({ store });

      const res = await sequence.call<{ sequence: string; value: number }>({
        connector: "sequence",
        operation: "next",
        payload: { name: "stored_seq", pattern: "DOC-${seq:3}" },
      });
      expect(res.sequence).toBe("DOC-001");

      // Verify record exists in store
      const record = await store.get("_sequences", "stored_seq");
      expect(record).toBeDefined();
      expect(record?.currentVal).toBe(1);
    });
  });

  describe("EmailConnector", () => {
    it("sends templated emails through MemoryEmailTransport", async () => {
      const transport = new MemoryEmailTransport();
      const email = new EmailConnector({
        defaultFrom: "billing@acme.corp",
        transport,
        templates: {
          order_receipt: {
            subject: "Receipt for Order #${orderId}",
            text: "Hello ${customerName}, your total is $${total}.",
            html: "<h1>Hello ${customerName}</h1><p>Your total is $${total}.</p>",
          },
        },
      });

      const sendResult = await email.call<{ success: boolean; messageId: string }>({
        connector: "email",
        operation: "send",
        payload: {
          to: "buyer@example.com",
          template: "order_receipt",
          params: {
            orderId: "ORD-9981",
            customerName: "Alice Wonderland",
            total: 150,
          },
        },
      });

      expect(sendResult.success).toBe(true);
      expect(sendResult.messageId).toBeDefined();

      const sent = transport.getSentMessages();
      expect(sent).toHaveLength(1);
      const firstSent = sent[0]!;
      expect(firstSent.to).toEqual(["buyer@example.com"]);
      expect(firstSent.from).toBe("billing@acme.corp");
      expect(firstSent.subject).toBe("Receipt for Order #ORD-9981");
      expect(firstSent.text).toBe("Hello Alice Wonderland, your total is $150.");
      expect(firstSent.html).toBe("<h1>Hello Alice Wonderland</h1><p>Your total is $150.</p>");
    });
  });

  describe("DefaultConnectors Registry", () => {
    it("routes to http, sequence, and email connectors seamlessly", async () => {
      const registry = new DefaultConnectors();

      expect(registry.list()).toContain("http");
      expect(registry.list()).toContain("sequence");
      expect(registry.list()).toContain("email");

      // Sequence via registry
      const seqRes = await registry.call<{ sequence: string; value: number }>({
        connector: "sequence",
        operation: "next",
        payload: { name: "reg_test", pattern: "REG-${seq:03}" },
      });
      expect(seqRes.sequence).toBe("REG-001");
    });
  });
});
