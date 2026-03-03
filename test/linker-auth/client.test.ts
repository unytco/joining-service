import { describe, it, expect, vi, beforeEach, type MockInstance } from 'vitest';
import { LinkerAuthClient } from '../../src/linker-auth/client.js';
import type { LinkerAdminInfo } from '../../src/linker-auth/types.js';

const ADMIN_URL = 'https://linker1.example.com';
const ADMIN_SECRET = 'test-secret';

function makeAdmin(overrides?: Partial<LinkerAdminInfo>): LinkerAdminInfo {
  return {
    url: ADMIN_URL,
    secret: ADMIN_SECRET,
    ...overrides,
  };
}

function makeClient(overrides?: Partial<LinkerAdminInfo>): LinkerAuthClient {
  return new LinkerAuthClient(makeAdmin(overrides));
}

function mockFetch(
  responses: Array<{ status: number; body?: unknown }>,
): MockInstance {
  let call = 0;
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    const { status, body } = responses[call++] ?? { status: 204 };
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
      json: async () => body,
    } as Response;
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('LinkerAuthClient.authorizeAgent', () => {
  it('sends POST /admin/agents with Bearer auth and agent data', async () => {
    const spy = mockFetch([{ status: 204 }]);
    const client = makeClient();
    await client.authorizeAgent('uhCAkabc123', ['dht_read', 'dht_write', 'k2']);

    expect(spy).toHaveBeenCalledOnce();
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${ADMIN_URL}/admin/agents`);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe(`Bearer ${ADMIN_SECRET}`);
    expect(headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({
      agent_pubkey: 'uhCAkabc123',
      capabilities: ['dht_read', 'dht_write', 'k2'],
    });
  });

  it('succeeds on 204 No Content', async () => {
    mockFetch([{ status: 204 }]);
    await expect(
      makeClient().authorizeAgent('uhCAkabc123', ['dht_read']),
    ).resolves.toBeUndefined();
  });

  it('throws on 401 Unauthorized', async () => {
    mockFetch([{ status: 401, body: 'unauthorized' }]);
    await expect(
      makeClient().authorizeAgent('uhCAkabc123', ['dht_read']),
    ).rejects.toThrow('401');
  });

  it('throws on 500 with error message', async () => {
    mockFetch([{ status: 500, body: 'internal error' }]);
    await expect(
      makeClient().authorizeAgent('uhCAkabc123', ['dht_read']),
    ).rejects.toThrow('500');
  });

  it('omits label when undefined', async () => {
    const spy = mockFetch([{ status: 204 }]);
    await makeClient().authorizeAgent('uhCAkabc123', ['dht_read']);

    const body = JSON.parse((spy.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body).not.toHaveProperty('label');
  });

  it('includes label when provided', async () => {
    const spy = mockFetch([{ status: 204 }]);
    await makeClient().authorizeAgent('uhCAkabc123', ['dht_read'], 'test-label');

    const body = JSON.parse((spy.mock.calls[0] as [string, RequestInit])[1].body as string);
    expect(body.label).toBe('test-label');
  });

  it('strips trailing slash from admin URL', async () => {
    const spy = mockFetch([{ status: 204 }]);
    const client = makeClient({ url: 'https://linker.example.com/' });
    await client.authorizeAgent('uhCAkabc123', ['dht_read']);

    const [url] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://linker.example.com/admin/agents');
  });
});
