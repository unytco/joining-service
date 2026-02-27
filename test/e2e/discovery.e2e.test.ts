import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { JoiningClient } from '../../src/client/index.js';
import { startE2EServer, type E2EServer } from './helpers.js';

describe('E2E: Discovery flow', () => {
  let server: E2EServer;

  beforeAll(async () => {
    server = await startE2EServer({
      auth_methods: ['open'],
      base_url: undefined, // let the server derive from request URL
    });
  });

  afterAll(async () => {
    await server.close();
  });

  it('well-known endpoint returns joining service URL', async () => {
    const res = await fetch(`${server.baseUrl}/.well-known/holo-joining`);
    expect(res.ok).toBe(true);

    const body = await res.json() as Record<string, unknown>;
    expect(body.happ_id).toBe('e2e-test-app');
    expect(body.version).toBe('1.0');
    expect(typeof body.joining_service_url).toBe('string');
  });

  it('can use well-known URL to create client and get info', async () => {
    // Fetch the well-known endpoint manually
    const res = await fetch(`${server.baseUrl}/.well-known/holo-joining`);
    const body = await res.json() as { joining_service_url: string };

    const client = JoiningClient.fromUrl(body.joining_service_url);
    const info = await client.getInfo();

    expect(info.happ.id).toBe('e2e-test-app');
    expect(info.auth_methods).toEqual(['open']);
  });

  it('well-known URL with base_url config uses configured URL', async () => {
    const serverWithBase = await startE2EServer({
      auth_methods: ['open'],
      base_url: 'https://my-service.example.com',
    });

    try {
      const res = await fetch(`${serverWithBase.baseUrl}/.well-known/holo-joining`);
      const body = await res.json() as Record<string, unknown>;
      expect(body.joining_service_url).toBe('https://my-service.example.com/v1');
    } finally {
      await serverWithBase.close();
    }
  });
});
