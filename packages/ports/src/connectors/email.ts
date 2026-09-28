/**
 * Kerangka Built-in Email Connector
 * Specification Version: 0.2
 * Status: Draft
 * License: Apache-2.0
 */

import { ConnectorHandler, ConnectorInvocation, ConnectorError } from "../connectors.js";

export interface PreparedEmailMessage {
  id: string;
  to: string[];
  from: string;
  subject: string;
  text?: string;
  html?: string;
  cc?: string[];
  bcc?: string[];
  replyTo?: string;
  headers?: Record<string, string>;
  sentAt: string;
  params?: Record<string, unknown>;
}

export interface EmailSendResult {
  success: boolean;
  messageId: string;
  to: string[];
  error?: string;
}

export interface EmailTransport {
  sendMail(message: PreparedEmailMessage): Promise<EmailSendResult>;
}

export class MemoryEmailTransport implements EmailTransport {
  private sent: PreparedEmailMessage[] = [];

  async sendMail(message: PreparedEmailMessage): Promise<EmailSendResult> {
    this.sent.push(message);
    return {
      success: true,
      messageId: message.id,
      to: message.to,
    };
  }

  getSentMessages(): PreparedEmailMessage[] {
    return [...this.sent];
  }

  findLatest(to?: string): PreparedEmailMessage | undefined {
    if (!to) return this.sent[this.sent.length - 1];
    return [...this.sent].reverse().find((m) => m.to.includes(to));
  }

  clear(): void {
    this.sent = [];
  }
}

export interface EmailTemplate {
  subject: string;
  text?: string;
  html?: string;
}

export interface EmailConnectorOptions {
  defaultFrom?: string;
  transport?: EmailTransport;
  templates?: Record<string, EmailTemplate>;
}

export interface EmailPayload {
  to: string | string[];
  from?: string;
  subject?: string;
  text?: string;
  html?: string;
  template?: string;
  params?: Record<string, unknown>;
  cc?: string | string[];
  bcc?: string | string[];
  replyTo?: string;
  headers?: Record<string, string>;
}

export class EmailConnector implements ConnectorHandler {
  readonly name = "email";
  private defaultFrom: string;
  private transport: EmailTransport;
  private templates = new Map<string, EmailTemplate>();

  constructor(options: EmailConnectorOptions = {}) {
    this.defaultFrom = options.defaultFrom || "noreply@kerangka.dev";
    this.transport = options.transport || new MemoryEmailTransport();
    if (options.templates) {
      for (const [k, v] of Object.entries(options.templates)) {
        this.templates.set(k, v);
      }
    }
  }

  registerTemplate(name: string, template: EmailTemplate): this {
    this.templates.set(name, template);
    return this;
  }

  getTemplate(name: string): EmailTemplate | undefined {
    return this.templates.get(name);
  }

  getTransport(): EmailTransport {
    return this.transport;
  }

  private interpolate(str: string, params?: Record<string, unknown>): string {
    if (!params) return str;
    return str.replace(/\$\{([^}]+)\}/g, (_match, key) => {
      const trimmed = key.trim();
      const val = params[trimmed];
      return val !== undefined && val !== null ? String(val) : "";
    });
  }

  async call<T = unknown>(invocation: ConnectorInvocation): Promise<T> {
    const operation = (invocation.operation || "send").toLowerCase();
    const payload = (invocation.payload || {}) as EmailPayload;

    if (!payload.to) {
      throw new ConnectorError(
        "Email connector requires 'to' recipient in payload.",
        this.name,
        operation,
        "INVALID_RECIPIENT"
      );
    }

    const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
    const fromAddress = payload.from || this.defaultFrom;
    const params = payload.params || {};

    let subject = payload.subject || "";
    let text = payload.text;
    let html = payload.html;

    if (payload.template) {
      const tmpl = this.templates.get(payload.template);
      if (!tmpl) {
        throw new ConnectorError(
          `Email template '${payload.template}' not found in registered templates.`,
          this.name,
          operation,
          "TEMPLATE_NOT_FOUND"
        );
      }
      subject = subject || tmpl.subject;
      text = text || tmpl.text;
      html = html || tmpl.html;
    }

    if (!subject) {
      throw new ConnectorError(
        "Email connector requires a subject or a template with a subject.",
        this.name,
        operation,
        "MISSING_SUBJECT"
      );
    }

    // Interpolate placeholders
    subject = this.interpolate(subject, params);
    if (text) text = this.interpolate(text, params);
    if (html) html = this.interpolate(html, params);

    const message: PreparedEmailMessage = {
      id: `mail_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      to: recipients,
      from: fromAddress,
      subject,
      text,
      html,
      cc: payload.cc ? (Array.isArray(payload.cc) ? payload.cc : [payload.cc]) : undefined,
      bcc: payload.bcc ? (Array.isArray(payload.bcc) ? payload.bcc : [payload.bcc]) : undefined,
      replyTo: payload.replyTo,
      headers: payload.headers,
      sentAt: new Date().toISOString(),
      params,
    };

    const sendRes = await this.transport.sendMail(message);
    return sendRes as T;
  }
}
