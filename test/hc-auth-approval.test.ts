import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HcAuthApprovalMethod } from '../src/auth-methods/hc-auth-approval.js';
import { HcAuthClient } from '../src/hc-auth/client.js';
import { fakeAgentKey } from './helpers.js';

function createMockClient() {
  const client = new HcAuthClient({
    url: 'https://auth.example.com',
    api_token: 'tok',
  });
  return {
    client,
    getRecord: vi.spyOn(client, 'getRecord'),
    requestAuth: vi.spyOn(client, 'requestAuth').mockResolvedValue(),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('HcAuthApprovalMethod', () => {
  describe('createChallenges', () => {
    it('registers agent as pending and returns challenge', async () => {
      const { client, getRecord, requestAuth } = createMockClient();
      getRecord.mockResolvedValue(null); // not found

      const plugin = new HcAuthApprovalMethod(client);
      const agentKey = fakeAgentKey();
      const challenges = await plugin.createChallenges(agentKey, {});

      expect(requestAuth).toHaveBeenCalledOnce();
      expect(challenges).toHaveLength(1);
      expect(challenges[0].type).toBe('hc_auth_approval');
      expect(challenges[0].description).toBe('Waiting for administrator approval');
      expect(challenges[0].metadata?.raw_key).toBeDefined();
      expect(challenges[0].metadata?.agent_key).toBe(agentKey);
    });

    it('returns empty array when agent is already authorized', async () => {
      const { client, getRecord, requestAuth } = createMockClient();
      getRecord.mockResolvedValue({
        state: 'authorized',
        pubKey: 'key',
      });

      const plugin = new HcAuthApprovalMethod(client);
      const challenges = await plugin.createChallenges(fakeAgentKey(), {});

      expect(challenges).toHaveLength(0);
      expect(requestAuth).not.toHaveBeenCalled();
    });

    it('creates challenge when agent is blocked (can be unblocked)', async () => {
      const { client, getRecord, requestAuth } = createMockClient();
      getRecord.mockResolvedValue({
        state: 'blocked',
        pubKey: 'key',
      });

      const plugin = new HcAuthApprovalMethod(client);
      const challenges = await plugin.createChallenges(fakeAgentKey(), {});

      expect(challenges).toHaveLength(1);
      expect(challenges[0].type).toBe('hc_auth_approval');
      // Should not re-register -- already in hc-auth
      expect(requestAuth).not.toHaveBeenCalled();
    });

    it('skips requestAuth when agent is already pending', async () => {
      const { client, getRecord, requestAuth } = createMockClient();
      getRecord.mockResolvedValue({
        state: 'pending',
        pubKey: 'key',
      });

      const plugin = new HcAuthApprovalMethod(client);
      const challenges = await plugin.createChallenges(fakeAgentKey(), {});

      expect(challenges).toHaveLength(1);
      expect(requestAuth).not.toHaveBeenCalled();
    });
  });

  describe('verifyChallengeResponse', () => {
    it('returns passed when hc-auth says authorized', async () => {
      const { client, getRecord } = createMockClient();
      getRecord.mockResolvedValue({ state: 'authorized', pubKey: 'key' });

      const plugin = new HcAuthApprovalMethod(client);
      const result = await plugin.verifyChallengeResponse(
        {
          id: 'ch_hc_auth_1',
          type: 'hc_auth_approval',
          description: 'test',
          metadata: { raw_key: 'some-key' },
        },
        'poll',
      );

      expect(result.passed).toBe(true);
    });

    it('returns failed with reason when blocked', async () => {
      const { client, getRecord } = createMockClient();
      getRecord.mockResolvedValue({ state: 'blocked', pubKey: 'key' });

      const plugin = new HcAuthApprovalMethod(client);
      const result = await plugin.verifyChallengeResponse(
        {
          id: 'ch_hc_auth_1',
          type: 'hc_auth_approval',
          description: 'test',
          metadata: { raw_key: 'some-key' },
        },
        'poll',
      );

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('Agent blocked by administrator');
    });

    it('returns failed when still pending', async () => {
      const { client, getRecord } = createMockClient();
      getRecord.mockResolvedValue({ state: 'pending', pubKey: 'key' });

      const plugin = new HcAuthApprovalMethod(client);
      const result = await plugin.verifyChallengeResponse(
        {
          id: 'ch_hc_auth_1',
          type: 'hc_auth_approval',
          description: 'test',
          metadata: { raw_key: 'some-key' },
        },
        'poll',
      );

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('Awaiting administrator approval');
    });

    it('returns failed when record not found', async () => {
      const { client, getRecord } = createMockClient();
      getRecord.mockResolvedValue(null);

      const plugin = new HcAuthApprovalMethod(client);
      const result = await plugin.verifyChallengeResponse(
        {
          id: 'ch_hc_auth_1',
          type: 'hc_auth_approval',
          description: 'test',
          metadata: { raw_key: 'some-key' },
        },
        'poll',
      );

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('Agent not registered in auth service');
    });

    it('returns failed when challenge metadata is missing', async () => {
      const { client } = createMockClient();

      const plugin = new HcAuthApprovalMethod(client);
      const result = await plugin.verifyChallengeResponse(
        {
          id: 'ch_hc_auth_1',
          type: 'hc_auth_approval',
          description: 'test',
        },
        'poll',
      );

      expect(result.passed).toBe(false);
      expect(result.reason).toBe('Challenge state missing');
    });
  });
});
