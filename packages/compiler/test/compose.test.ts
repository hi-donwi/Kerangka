import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { compile, emitDockerCompose } from '../src/index.js';

describe('Docker Compose Generator', () => {
  const sampleModel = {
    kerangka: '0.1',
    app: 'CommercePlatform',
    entities: {
      Product: {
        fields: {
          id: { type: 'string', required: true },
          name: { type: 'string', required: true },
          price: { type: 'decimal', precision: 12, scale: 2, required: true },
        },
      },
    },
  };

  it('generates a valid docker-compose.yml structure with postgres, valkey, nats and app', () => {
    const kir = compile(sampleModel as any);
    const result = emitDockerCompose(kir, { appPort: 8080 });

    expect(result.services).toContain('app');
    expect(result.services).toContain('postgres');
    expect(result.services).toContain('valkey');
    expect(result.services).toContain('nats');

    const parsed = parse(result.yaml);
    expect(parsed.name).toBe('commerceplatform');
    expect(parsed.services.app.ports).toContain('8080:8080');
    expect(parsed.services.postgres.image).toBe('postgres:16-alpine');
    expect(parsed.services.valkey.image).toBe('valkey/valkey:8-alpine');
    expect(parsed.services.nats.image).toBe('nats:2.10-alpine');
    expect(parsed.volumes).toHaveProperty('postgres_data');
  });

  it('respects inclusion flags for services', () => {
    const kir = compile(sampleModel as any);
    const result = emitDockerCompose(kir, {
      includePostgres: false,
      includeCache: false,
      includeBus: false,
    });

    expect(result.services).toEqual(['app']);
    const parsed = parse(result.yaml);
    expect(parsed.services.postgres).toBeUndefined();
    expect(parsed.services.valkey).toBeUndefined();
    expect(parsed.services.nats).toBeUndefined();
    expect(parsed.volumes).toBeUndefined();
  });
});
