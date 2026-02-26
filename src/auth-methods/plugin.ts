import type { Challenge } from '../types.js';

export interface AuthMethodPlugin {
  type: string;

  createChallenges(
    agentKey: string,
    claims: Record<string, string>,
    config: unknown,
  ): Promise<Challenge[]>;

  verifyChallengeResponse(
    challenge: Challenge,
    response: string,
    claims: Record<string, string>,
  ): Promise<{ passed: boolean; reason?: string }>;
}
