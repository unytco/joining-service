import type { Challenge } from '../types.js';
import type { AuthMethodPlugin } from './plugin.js';

export class OpenAuthMethod implements AuthMethodPlugin {
  type = 'open';

  async createChallenges(): Promise<Challenge[]> {
    return [];
  }

  async verifyChallengeResponse(): Promise<{ passed: boolean }> {
    return { passed: true };
  }
}
