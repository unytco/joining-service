import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { JoiningClient, JoiningError } from '../../src/client/index.js';
import { startE2EServer, fakeAgentKey, type E2EServer } from './helpers.js';

describe('E2E: Invite code flow', () => {
  let server: E2EServer;
  let client: JoiningClient;

  beforeAll(async () => {
    server = await startE2EServer({
      auth_methods: ['invite_code'],
      invite_codes: ['VALID-CODE-1', 'VALID-CODE-2'],
    });
    client = JoiningClient.fromUrl(`${server.baseUrl}/v1`);
  });

  afterAll(async () => {
    await server.close();
  });

  it('join with valid invite code returns ready', async () => {
    const agentKey = fakeAgentKey(20);
    const session = await client.join(agentKey, { invite_code: 'VALID-CODE-1' });

    expect(session.status).toBe('ready');
  });

  it('join with invalid invite code returns rejected', async () => {
    const agentKey = fakeAgentKey(21);
    const session = await client.join(agentKey, { invite_code: 'WRONG-CODE' });

    expect(session.status).toBe('rejected');
    expect(session.reason).toBeTruthy();
  });

  it('credentials available after valid invite join', async () => {
    const agentKey = fakeAgentKey(22);
    const session = await client.join(agentKey, { invite_code: 'VALID-CODE-2' });
    expect(session.status).toBe('ready');

    const creds = await session.getCredentials();
    expect(creds.linker_urls).toEqual(['wss://linker.example.com:8090']);
  });
});
