import type { Challenge } from '../types.js';
import type { AuthMethodPlugin } from './plugin.js';
import type { HcAuthClient } from '../hc-auth/client.js';
import { agentKeyToRawEd25519Base64url } from '../utils.js';

/**
 * Auth method that delegates approval decisions to hc-auth-server.
 *
 * On join, the agent is registered as pending in hc-auth. The client polls
 * GET /status until an operator approves (or blocks) the agent via the
 * hc-auth ops console or an external KYC provider calls /api/transition.
 *
 * When used, notifyHcAuth (registerAndAuthorize) is skipped at ready-time
 * because hc-auth already controls the authorization state.
 */
export class HcAuthApprovalMethod implements AuthMethodPlugin {
  type = 'hc_auth_approval';

  constructor(private readonly hcAuthClient: HcAuthClient) {}

  async createChallenges(
    agentKey: string,
    _claims: Record<string, string>,
  ): Promise<Challenge[]> {
    const rawKey = agentKeyToRawEd25519Base64url(agentKey);

    const existing = await this.hcAuthClient.getRecord(rawKey);

    // Already authorized -- no challenge needed (auto-pass)
    if (existing?.state === 'authorized') {
      return [];
    }

    // Register as pending if not already in hc-auth
    if (!existing) {
      await this.hcAuthClient.requestAuth(rawKey, { agent_key: agentKey });
    }
    // If blocked, still create the challenge -- operator may unblock later

    const expiresAt = new Date(Date.now() + 86_400_000).toISOString(); // 24h

    return [
      {
        id: `ch_hc_auth_${Date.now()}`,
        type: 'hc_auth_approval',
        description: 'Waiting for administrator approval',
        expires_at: expiresAt,
        metadata: {
          raw_key: rawKey,
          agent_key: agentKey,
        },
      },
    ];
  }

  async verifyChallengeResponse(
    challenge: Challenge,
    _response: string,
  ): Promise<{ passed: boolean; reason?: string }> {
    const rawKey = challenge.metadata?.raw_key as string | undefined;
    if (!rawKey) {
      return { passed: false, reason: 'Challenge state missing' };
    }

    const record = await this.hcAuthClient.getRecord(rawKey);

    if (!record) {
      return { passed: false, reason: 'Agent not registered in auth service' };
    }

    if (record.state === 'authorized') {
      return { passed: true };
    }

    if (record.state === 'blocked') {
      return { passed: false, reason: 'Agent blocked by administrator' };
    }

    // pending
    return { passed: false, reason: 'Awaiting administrator approval' };
  }
}
