import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { JoiningClient } from '../../src/client/index.js';
import { startE2EServer, fakeAgentKey, type E2EServer } from './helpers.js';
import { readFileSync, readdirSync, mkdirSync, rmSync } from 'node:fs';

const EMAIL_DIR = '/tmp/e2e-email-test-' + Date.now();

describe('E2E: Email verification flow', () => {
  let server: E2EServer;
  let client: JoiningClient;

  beforeAll(async () => {
    mkdirSync(EMAIL_DIR, { recursive: true });
    server = await startE2EServer({
      auth_methods: ['email_code'],
      email: { provider: 'file', output_dir: EMAIL_DIR },
    });
    client = JoiningClient.fromUrl(`${server.baseUrl}/v1`);
  });

  afterAll(async () => {
    await server.close();
    rmSync(EMAIL_DIR, { recursive: true, force: true });
  });

  it('join with email claim returns pending with email_code challenge', async () => {
    const agentKey = fakeAgentKey(10);
    const session = await client.join(agentKey, { email: 'test@example.com' });

    expect(session.status).toBe('pending');
    expect(session.challenges).toHaveLength(1);
    expect(session.challenges![0].type).toBe('email_code');
    expect(session.pollIntervalMs).toBe(2000);
  });

  it('full flow: join → read code → verify → provision', async () => {
    const agentKey = fakeAgentKey(11);
    const session = await client.join(agentKey, { email: 'alice@example.com' });
    expect(session.status).toBe('pending');

    // Read the verification code from the file transport output
    const files = readdirSync(EMAIL_DIR).sort();
    // Find the email sent to alice@example.com
    const aliceFile = files.find((f) => f.includes('alice@example.com'));
    expect(aliceFile).toBeTruthy();
    const emailContent = readFileSync(`${EMAIL_DIR}/${aliceFile}`, 'utf-8');
    const codeMatch = emailContent.match(/code\s+is:\s+(\d{6})/i);
    expect(codeMatch).toBeTruthy();
    const code = codeMatch![1];

    // Verify with the code
    const challengeId = session.challenges![0].id;
    const verified = await session.verify(challengeId, code);
    expect(verified.status).toBe('ready');

    // Get provision
    const creds = await verified.getProvision();
    expect(creds.linker_urls).toEqual(['wss://linker.example.com:8090']);
  });

  it('pollStatus shows pending until verified', async () => {
    const agentKey = fakeAgentKey(12);
    const session = await client.join(agentKey, { email: 'bob@example.com' });

    const polled = await session.pollStatus();
    expect(polled.status).toBe('pending');
  });
});
