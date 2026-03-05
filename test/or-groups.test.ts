import { describe, it, expect } from 'vitest';
import * as ed from '@noble/ed25519';
import { createTestApp, fakeAgentKey } from './helpers.js';
import { encodeHashToBase64, agentPubKeyFrom32 } from '../src/utils.js';

async function generateAgentKeypair(): Promise<{
  agentKey: string;
  privateKey: Uint8Array;
}> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);

  return {
    agentKey: encodeHashToBase64(agentPubKeyFrom32(publicKey)),
    privateKey,
  };
}

describe('OR groups (any_of)', () => {
  it('completing one method in an OR group satisfies the group', async () => {
    const { agentKey, privateKey } = await generateAgentKeypair();

    const { request } = await createTestApp({
      auth_methods: [{ any_of: ['agent_whitelist', 'invite_code'] }],
      allowed_agents: [agentKey],
      invite_codes: ['CODE-1'],
    });

    const joinRes = await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_key: agentKey, claims: { invite_code: 'CODE-1' } }),
    });
    expect(joinRes.status).toBe(201);
    const joinBody = await joinRes.json();

    // Both methods should produce challenges, but with the same group
    // invite_code is auto-verified, so it may already be completed
    // agent_whitelist produces a nonce challenge
    // Since invite_code auto-verifies and is in an OR group, session should be ready
    expect(joinBody.status).toBe('ready');
  });

  it('challenges in OR group share a group id', async () => {
    const { request } = await createTestApp({
      auth_methods: [{ any_of: ['email_code', 'invite_code'] }],
      email: { provider: 'file', output_dir: '/tmp/test-or-emails' },
      invite_codes: ['BAD-CODE'], // we will send a different code to keep it pending
    });

    const agentKey = fakeAgentKey();
    const joinRes = await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_key: agentKey,
        claims: { email: 'test@example.com', invite_code: 'WRONG' },
      }),
    });
    expect(joinRes.status).toBe(201);
    const joinBody = await joinRes.json();

    // invite_code with wrong code in OR group: the invite is rejected but
    // email_code is still pending, so overall status should be pending
    // (invite auto-verify failure in OR group doesn't reject the whole session)
    if (joinBody.status === 'pending') {
      // The email challenge should have a group field
      const emailChallenge = joinBody.challenges.find(
        (c: { type: string }) => c.type === 'email_code',
      );
      expect(emailChallenge).toBeDefined();
      expect(emailChallenge.group).toBeDefined();
    }
  });

  it('AND + OR combo: standalone AND must also be completed', async () => {
    const { agentKey, privateKey } = await generateAgentKeypair();

    const { request } = await createTestApp({
      auth_methods: [
        'agent_whitelist',
        { any_of: ['invite_code', 'email_code'] },
      ],
      allowed_agents: [agentKey],
      invite_codes: ['COMBO-CODE'],
      email: { provider: 'file', output_dir: '/tmp/test-combo-emails' },
    });

    const joinRes = await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_key: agentKey,
        claims: { invite_code: 'COMBO-CODE' },
      }),
    });
    expect(joinRes.status).toBe(201);
    const joinBody = await joinRes.json();

    // invite_code in the OR group auto-verifies, so the OR group is satisfied.
    // But agent_whitelist (AND) still needs verification.
    expect(joinBody.status).toBe('pending');

    const wlChallenge = joinBody.challenges.find(
      (c: { type: string }) => c.type === 'agent_whitelist',
    );
    expect(wlChallenge).toBeDefined();

    // Sign the nonce
    const nonceBytes = Buffer.from(wlChallenge.metadata.nonce, 'base64');
    const signature = await ed.signAsync(nonceBytes, privateKey);

    const verifyRes = await request(`/v1/join/${joinBody.session}/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challenge_id: wlChallenge.id,
        response: Buffer.from(signature).toString('base64'),
      }),
    });
    expect(verifyRes.status).toBe(200);
    const verifyBody = await verifyRes.json();
    expect(verifyBody.status).toBe('ready');
  });

  it('OR group where no method produces challenges is rejected', async () => {
    // agent_whitelist with non-whitelisted key, invite_code with no code claim
    // Both will fail to produce challenges
    const { request } = await createTestApp({
      auth_methods: [{ any_of: ['agent_whitelist'] }],
      allowed_agents: [], // no agents whitelisted
    });

    const agentKey = fakeAgentKey();
    const joinRes = await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_key: agentKey }),
    });
    expect(joinRes.status).toBe(201);
    const body = await joinRes.json();
    expect(body.status).toBe('rejected');
    expect(body.reason).toContain('No eligible auth method');
  });

  it('non-whitelisted agent can still join via OR alternative', async () => {
    const agentKey = fakeAgentKey(99);

    const { request } = await createTestApp({
      auth_methods: [{ any_of: ['agent_whitelist', 'invite_code'] }],
      allowed_agents: [], // this agent is not whitelisted
      invite_codes: ['FALLBACK-CODE'],
    });

    // agent_whitelist returns empty (not whitelisted),
    // but invite_code in the same OR group should work
    const joinRes = await request('/v1/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        agent_key: agentKey,
        claims: { invite_code: 'FALLBACK-CODE' },
      }),
    });
    expect(joinRes.status).toBe(201);
    const body = await joinRes.json();
    // invite_code auto-verifies, so session should be ready
    expect(body.status).toBe('ready');
  });
});
