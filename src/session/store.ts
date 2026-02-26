import type { Challenge } from '../types.js';

export type SessionStatus = 'ready' | 'pending' | 'rejected';

export interface SessionData {
  id: string;
  agent_key: string;
  status: SessionStatus;
  challenges: ChallengeState[];
  claims: Record<string, string>;
  created_at: number;
  reason?: string;
}

export interface ChallengeState {
  challenge: Challenge;
  expected_response: string;
  completed: boolean;
  attempts: number;
  expires_at: number;
}

export interface SessionStore {
  create(data: SessionData): Promise<void>;
  get(sessionId: string): Promise<SessionData | null>;
  update(sessionId: string, data: Partial<SessionData>): Promise<void>;
  delete(sessionId: string): Promise<void>;
  findByAgentKey(agentKey: string): Promise<SessionData | null>;
}
