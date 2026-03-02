import { describe, it, expect } from 'vitest';
import * as ed from '@noble/ed25519';
import { createTestApp } from './helpers.js';

// Build a proper 39-byte AgentPubKey from a real ed25519 public key
function buildAgentKey(publicKey: Uint8Array): string {
  // 3-byte prefix + 32-byte pubkey + 4-byte DHT location
  const bytes = new Uint8Array(39);
  bytes[0] = 0x84;
  bytes[1] = 0x20;
  bytes[2] = 0x24;
  bytes.set(publicKey, 3);
  // Last 4 bytes are DHT location (can be anything)
  bytes[35] = 0x00;
  bytes[36] = 0x00;
  bytes[37] = 0x00;
  bytes[38] = 0x00;
  return Buffer.from(bytes).toString('base64');
}

describe('Reconnect flow', () => {
  it('reconnect with valid signature returns updated URLs', async () => {
    const { request } = await createTestApp({
      reconnect: { enabled: true, timestamp_tolerance_seconds: 300 },
    });

    // Generate a real ed25519 key pair
    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = await ed.getPublicKeyAsync(privateKey);
    const agentKey = buildAgentKey(publicKey);

    // First, join to register the agent
    const joinRes = await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_key: agentKey }),
    });
    expect(joinRes.status).toBe(201);

    // Now reconnect
    const timestamp = new Date().toISOString();
    const msgBytes = new TextEncoder().encode(timestamp);
    const signature = await ed.signAsync(msgBytes, privateKey);
    const signatureB64 = Buffer.from(signature).toString('base64');

    const reconnRes = await request('/v1/reconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_key: agentKey,
        timestamp,
        signature: signatureB64,
      }),
    });

    expect(reconnRes.status).toBe(200);
    const body = await reconnRes.json();
    expect(body.linker_urls).toEqual([{ url: 'wss://linker.example.com:8090' }]);
  });

  it('reconnect with invalid signature returns 400', async () => {
    const { request } = await createTestApp({
      reconnect: { enabled: true },
    });

    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = await ed.getPublicKeyAsync(privateKey);
    const agentKey = buildAgentKey(publicKey);

    // Join first
    await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_key: agentKey }),
    });

    const timestamp = new Date().toISOString();
    // Sign with a DIFFERENT key
    const wrongKey = ed.utils.randomPrivateKey();
    const wrongSig = await ed.signAsync(
      new TextEncoder().encode(timestamp),
      wrongKey,
    );

    const res = await request('/v1/reconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_key: agentKey,
        timestamp,
        signature: Buffer.from(wrongSig).toString('base64'),
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('invalid_signature');
  });

  it('reconnect for unknown agent returns 403', async () => {
    const { request } = await createTestApp({
      reconnect: { enabled: true },
    });

    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = await ed.getPublicKeyAsync(privateKey);
    const agentKey = buildAgentKey(publicKey);

    const timestamp = new Date().toISOString();
    const sig = await ed.signAsync(
      new TextEncoder().encode(timestamp),
      privateKey,
    );

    const res = await request('/v1/reconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_key: agentKey,
        timestamp,
        signature: Buffer.from(sig).toString('base64'),
      }),
    });

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('agent_not_joined');
  });

  it('reconnect with stale timestamp returns 400', async () => {
    const { request } = await createTestApp({
      reconnect: { enabled: true, timestamp_tolerance_seconds: 300 },
    });

    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = await ed.getPublicKeyAsync(privateKey);
    const agentKey = buildAgentKey(publicKey);

    // Join first
    await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_key: agentKey }),
    });

    // Timestamp 10 minutes ago (beyond 5 min tolerance)
    const staleTs = new Date(Date.now() - 600_000).toISOString();
    const sig = await ed.signAsync(
      new TextEncoder().encode(staleTs),
      privateKey,
    );

    const res = await request('/v1/reconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_key: agentKey,
        timestamp: staleTs,
        signature: Buffer.from(sig).toString('base64'),
      }),
    });

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('timestamp_out_of_range');
  });

  it('reconnect when disabled returns 404', async () => {
    const { request } = await createTestApp({
      reconnect: { enabled: false },
    });

    const res = await request('/v1/reconnect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_key: 'test',
        timestamp: new Date().toISOString(),
        signature: 'test',
      }),
    });

    expect(res.status).toBe(404);
  });
});
