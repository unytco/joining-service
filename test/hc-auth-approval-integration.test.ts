import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as ed from '@noble/ed25519';
import { createTestApp, fakeAgentKey } from './helpers.js';
import { HcAuthClient } from '../src/hc-auth/client.js';
import type { HcAuthRecord } from '../src/hc-auth/client.js';
import { encodeHashToBase64, agentPubKeyFrom32 } from '../src/utils.js';

function createMockClient(required = false) {
  const client = new HcAuthClient({
    url: 'https://auth.example.com',
    api_token: 'tok',
    required,
  });
  return {
    client,
    getRecord: vi.spyOn(client, 'getRecord'),
    requestAuth: vi.spyOn(client, 'requestAuth').mockResolvedValue(),
    registerAndAuthorize: vi.spyOn(client, 'registerAndAuthorize').mockResolvedValue(),
  };
}

async function generateAgentKeypair() {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);
  return {
    agentKey: encodeHashToBase64(agentPubKeyFrom32(publicKey)),
    privateKey,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('hc_auth_approval — full flow via status polling', () => {
  it('join pending → poll → authorized → ready → provision', async () => {
    const mock = createMockClient();
    // createChallenges: agent not found → register as pending
    mock.getRecord.mockResolvedValueOnce(null);

    const agentKey = fakeAgentKey(10);
    const { request } = await createTestApp(
      { auth_methods: ['hc_auth_approval'] },
      undefined,
      undefined,
      mock.client,
    );

    // Join: pending
    const joinRes = await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_key: agentKey }),
    });
    expect(joinRes.status).toBe(201);
    const joinBody = await joinRes.json();
    expect(joinBody.status).toBe('pending');
    expect(joinBody.challenges).toHaveLength(1);
    expect(joinBody.challenges[0].type).toBe('hc_auth_approval');
    // raw_key and agent_key should be stripped from client metadata
    expect(joinBody.challenges[0].metadata?.raw_key).toBeUndefined();
    expect(joinBody.challenges[0].metadata?.agent_key).toBeUndefined();

    // Poll status: still pending
    mock.getRecord.mockResolvedValueOnce({ state: 'pending', pubKey: 'k' });
    const statusRes1 = await request(`/v1/join/${joinBody.session}/status`);
    const statusBody1 = await statusRes1.json();
    expect(statusBody1.status).toBe('pending');

    // Operator approves in hc-auth
    mock.getRecord.mockResolvedValueOnce({ state: 'authorized', pubKey: 'k' });
    const statusRes2 = await request(`/v1/join/${joinBody.session}/status`);
    const statusBody2 = await statusRes2.json();
    expect(statusBody2.status).toBe('ready');

    // Provision
    const provRes = await request(`/v1/join/${joinBody.session}/provision`);
    expect(provRes.status).toBe(200);
    const prov = await provRes.json();
    expect(prov.linker_urls).toBeDefined();
  });

  it('blocked during pending → rejected', async () => {
    const mock = createMockClient();
    mock.getRecord.mockResolvedValueOnce(null); // createChallenges

    const agentKey = fakeAgentKey(20);
    const { request } = await createTestApp(
      { auth_methods: ['hc_auth_approval'] },
      undefined,
      undefined,
      mock.client,
    );

    const joinRes = await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_key: agentKey }),
    });
    const joinBody = await joinRes.json();
    expect(joinBody.status).toBe('pending');

    // Operator blocks
    mock.getRecord.mockResolvedValueOnce({ state: 'blocked', pubKey: 'k' });
    const statusRes = await request(`/v1/join/${joinBody.session}/status`);
    const statusBody = await statusRes.json();
    expect(statusBody.status).toBe('rejected');
    expect(statusBody.reason).toBe('Agent blocked by administrator');
  });

  it('revocation after ready → provision returns 403', async () => {
    const mock = createMockClient();
    mock.getRecord.mockResolvedValueOnce(null); // createChallenges

    const agentKey = fakeAgentKey(30);
    const { request } = await createTestApp(
      { auth_methods: ['hc_auth_approval'] },
      undefined,
      undefined,
      mock.client,
    );

    // Join
    const joinRes = await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_key: agentKey }),
    });
    const joinBody = await joinRes.json();

    // Approve via status poll
    mock.getRecord.mockResolvedValueOnce({ state: 'authorized', pubKey: 'k' });
    const statusRes = await request(`/v1/join/${joinBody.session}/status`);
    expect((await statusRes.json()).status).toBe('ready');

    // Operator revokes
    mock.getRecord.mockResolvedValueOnce({ state: 'blocked', pubKey: 'k' });
    const provRes = await request(`/v1/join/${joinBody.session}/provision`);
    expect(provRes.status).toBe(403);
    const body = await provRes.json();
    expect(body.error.code).toBe('agent_revoked');
  });

  it('reconnect gating: blocked agent gets 403', async () => {
    const mock = createMockClient();
    mock.getRecord.mockResolvedValueOnce(null); // createChallenges

    const { agentKey, privateKey } = await generateAgentKeypair();
    const { request } = await createTestApp(
      {
        auth_methods: ['hc_auth_approval'],
        reconnect: { enabled: true },
      },
      undefined,
      undefined,
      mock.client,
    );

    // Join + approve
    const joinRes = await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_key: agentKey }),
    });
    const joinBody = await joinRes.json();

    mock.getRecord.mockResolvedValueOnce({ state: 'authorized', pubKey: 'k' });
    await request(`/v1/join/${joinBody.session}/status`);

    // Reconnect with blocked agent
    mock.getRecord.mockResolvedValueOnce({ state: 'blocked', pubKey: 'k' });

    const timestamp = new Date().toISOString();
    const msgBytes = new TextEncoder().encode(timestamp);
    const signature = await ed.signAsync(msgBytes, privateKey);

    const reconnRes = await request('/v1/reconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_key: agentKey,
        timestamp,
        signature: Buffer.from(signature).toString('base64'),
      }),
    });
    expect(reconnRes.status).toBe(403);
    const body = await reconnRes.json();
    expect(body.error.code).toBe('agent_revoked');
  });

  it('hc-auth unreachable during poll: returns current pending state', async () => {
    const mock = createMockClient();
    mock.getRecord.mockResolvedValueOnce(null); // createChallenges

    const agentKey = fakeAgentKey(50);
    const { request } = await createTestApp(
      { auth_methods: ['hc_auth_approval'] },
      undefined,
      undefined,
      mock.client,
    );

    const joinRes = await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_key: agentKey }),
    });
    const joinBody = await joinRes.json();

    // hc-auth unreachable
    mock.getRecord.mockRejectedValueOnce(new Error('connection refused'));
    const statusRes = await request(`/v1/join/${joinBody.session}/status`);
    const statusBody = await statusRes.json();
    expect(statusBody.status).toBe('pending');
  });

  it('hc-auth unreachable + required: provision returns 503', async () => {
    const mock = createMockClient(true);
    mock.getRecord.mockResolvedValueOnce(null); // createChallenges

    const agentKey = fakeAgentKey(60);
    const { request } = await createTestApp(
      {
        auth_methods: ['hc_auth_approval'],
        hc_auth: { url: 'https://auth.example.com', api_token: 'tok', required: true },
      },
      undefined,
      undefined,
      mock.client,
    );

    // Join
    const joinRes = await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_key: agentKey }),
    });
    const joinBody = await joinRes.json();

    // Approve via status poll
    mock.getRecord.mockResolvedValueOnce({ state: 'authorized', pubKey: 'k' });
    await request(`/v1/join/${joinBody.session}/status`);

    // Provision with hc-auth unreachable
    mock.getRecord.mockRejectedValueOnce(new Error('connection refused'));
    const provRes = await request(`/v1/join/${joinBody.session}/provision`);
    expect(provRes.status).toBe(503);
  });

  it('notifyHcAuth (registerAndAuthorize) is NOT called for hc_auth_approval', async () => {
    const mock = createMockClient();
    mock.getRecord.mockResolvedValueOnce(null); // createChallenges

    const agentKey = fakeAgentKey(70);
    const { request } = await createTestApp(
      { auth_methods: ['hc_auth_approval'] },
      undefined,
      undefined,
      mock.client,
    );

    // Join
    const joinRes = await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_key: agentKey }),
    });
    const joinBody = await joinRes.json();

    // Approve via status poll
    mock.getRecord.mockResolvedValueOnce({ state: 'authorized', pubKey: 'k' });
    const statusRes = await request(`/v1/join/${joinBody.session}/status`);
    expect((await statusRes.json()).status).toBe('ready');

    // registerAndAuthorize should NOT have been called
    expect(mock.registerAndAuthorize).not.toHaveBeenCalled();
  });

  it('already authorized in hc-auth → immediate ready (no challenge)', async () => {
    const mock = createMockClient();
    mock.getRecord.mockResolvedValueOnce({ state: 'authorized', pubKey: 'k' });

    const agentKey = fakeAgentKey(80);
    const { request } = await createTestApp(
      { auth_methods: ['hc_auth_approval'] },
      undefined,
      undefined,
      mock.client,
    );

    const joinRes = await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_key: agentKey }),
    });
    expect(joinRes.status).toBe(201);
    const joinBody = await joinRes.json();
    expect(joinBody.status).toBe('ready');
  });
});

describe('hc_auth_approval — combined with email_code', () => {
  it('both email_code AND hc_auth_approval must pass', async () => {
    const mock = createMockClient();
    mock.getRecord.mockResolvedValueOnce(null); // createChallenges for hc_auth_approval

    const agentKey = fakeAgentKey(90);
    const { request, ctx } = await createTestApp(
      {
        auth_methods: ['email_code', 'hc_auth_approval'],
        email: { provider: 'file', output_dir: '/tmp/test-emails-combo' },
      },
      undefined,
      undefined,
      mock.client,
    );

    // Join: should have 2 challenges
    const joinRes = await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_key: agentKey,
        claims: { email: 'test@example.com' },
      }),
    });
    expect(joinRes.status).toBe(201);
    const joinBody = await joinRes.json();
    expect(joinBody.status).toBe('pending');
    expect(joinBody.challenges).toHaveLength(2);

    const emailChallenge = joinBody.challenges.find(
      (c: { type: string }) => c.type === 'email_code',
    );
    const hcAuthChallenge = joinBody.challenges.find(
      (c: { type: string }) => c.type === 'hc_auth_approval',
    );
    expect(emailChallenge).toBeDefined();
    expect(hcAuthChallenge).toBeDefined();

    // Verify email code
    const sessionData = await ctx.sessionStore.get(joinBody.session);
    const emailState = sessionData!.challenges.find(
      (cs) => cs.challenge.type === 'email_code',
    );
    const verifyRes = await request(`/v1/join/${joinBody.session}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge_id: emailChallenge.id,
        response: emailState!.expected_response,
      }),
    });
    expect(verifyRes.status).toBe(200);
    const verifyBody = await verifyRes.json();
    // Still pending -- hc_auth_approval not done yet
    expect(verifyBody.status).toBe('pending');

    // Now approve in hc-auth via status poll
    mock.getRecord.mockResolvedValueOnce({ state: 'authorized', pubKey: 'k' });
    const statusRes = await request(`/v1/join/${joinBody.session}/status`);
    const statusBody = await statusRes.json();
    expect(statusBody.status).toBe('ready');

    // registerAndAuthorize should NOT have been called (hc_auth_approval gates it)
    expect(mock.registerAndAuthorize).not.toHaveBeenCalled();
  });
});
