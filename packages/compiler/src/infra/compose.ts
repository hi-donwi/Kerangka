/**
 * Docker Compose Infrastructure Generator
 * Specification Version: 0.1
 * Status: Draft
 * License: Apache-2.0
 */

import { stringify } from 'yaml';
import type { KIRDocument } from '../types.js';

export interface ComposeOptions {
  includePostgres?: boolean;
  includeCache?: boolean;
  includeBus?: boolean;
  appPort?: number;
  appImage?: string;
}

export interface ComposeResult {
  yaml: string;
  services: string[];
}

/**
 * Emits a production-ready Docker Compose infrastructure definition
 * configured for the Kerangka application and its declared adapters.
 */
export function emitDockerCompose(
  kir: KIRDocument,
  options: ComposeOptions = {}
): ComposeResult {
  const appName = (kir.app || 'kerangka-app').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const appPort = options.appPort ?? 3000;
  const includePostgres = options.includePostgres !== false;
  const includeCache = options.includeCache !== false;
  const includeBus = options.includeBus !== false;
  const appImage = options.appImage ?? 'ghcr.io/hi-donwi/kerangka:latest';

  const services: Record<string, unknown> = {};
  const volumes: Record<string, unknown> = {};
  const dependsOn: Record<string, { condition: string }> = {};

  const appEnv: Record<string, string | number> = {
    PORT: appPort,
    NODE_ENV: 'production',
    KERANGKA_APP: appName,
  };

  if (includePostgres) {
    services['postgres'] = {
      image: 'postgres:16-alpine',
      container_name: `${appName}-postgres`,
      environment: {
        POSTGRES_USER: 'kerangka',
        POSTGRES_PASSWORD: 'kerangka_secret_password',
        POSTGRES_DB: appName,
      },
      ports: ['5432:5432'],
      volumes: ['postgres_data:/var/lib/postgresql/data'],
      healthcheck: {
        test: ['CMD-SHELL', `pg_isready -U kerangka -d ${appName}`],
        interval: '5s',
        timeout: '5s',
        retries: 5,
      },
      restart: 'unless-stopped',
    };
    volumes['postgres_data'] = {};
    dependsOn['postgres'] = { condition: 'service_healthy' };
    appEnv['DATABASE_URL'] = `postgres://kerangka:kerangka_secret_password@postgres:5432/${appName}`;
  }

  if (includeCache) {
    services['valkey'] = {
      image: 'valkey/valkey:8-alpine',
      container_name: `${appName}-valkey`,
      ports: ['6379:6379'],
      volumes: ['valkey_data:/data'],
      restart: 'unless-stopped',
    };
    volumes['valkey_data'] = {};
    dependsOn['valkey'] = { condition: 'service_started' };
    appEnv['CACHE_URL'] = 'redis://valkey:6379';
  }

  if (includeBus) {
    services['nats'] = {
      image: 'nats:2.10-alpine',
      container_name: `${appName}-nats`,
      ports: ['4222:4222', '8222:8222'],
      restart: 'unless-stopped',
    };
    dependsOn['nats'] = { condition: 'service_started' };
    appEnv['BUS_URL'] = 'nats://nats:4222';
  }

  // App service definition
  services['app'] = {
    image: appImage,
    container_name: appName,
    ports: [`${appPort}:${appPort}`],
    environment: appEnv,
    depends_on: dependsOn,
    restart: 'unless-stopped',
  };

  const composeDoc: Record<string, unknown> = {
    name: appName,
    services,
  };

  if (Object.keys(volumes).length > 0) {
    composeDoc['volumes'] = volumes;
  }

  const yaml = stringify(composeDoc, { indent: 2 });
  return {
    yaml,
    services: Object.keys(services),
  };
}
