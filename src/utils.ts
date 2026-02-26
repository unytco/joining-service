import { randomBytes } from 'node:crypto';

export function generateSessionId(): string {
  return `js_${randomBytes(16).toString('hex')}`;
}

export function toBase64(data: Uint8Array): string {
  return Buffer.from(data).toString('base64');
}

export function fromBase64(str: string): Uint8Array {
  return new Uint8Array(Buffer.from(str, 'base64'));
}

const AGENT_KEY_PREFIX = new Uint8Array([0x84, 0x20, 0x24]);

export function validateAgentKey(agentKey: string): {
  valid: boolean;
  reason?: string;
} {
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(agentKey);
  } catch {
    return { valid: false, reason: 'Agent key is not valid base64' };
  }

  if (bytes.length !== 39) {
    return {
      valid: false,
      reason: `Agent key must be 39 bytes, got ${bytes.length}`,
    };
  }

  if (
    bytes[0] !== AGENT_KEY_PREFIX[0] ||
    bytes[1] !== AGENT_KEY_PREFIX[1] ||
    bytes[2] !== AGENT_KEY_PREFIX[2]
  ) {
    return {
      valid: false,
      reason: 'Agent key does not have valid AgentPubKey prefix',
    };
  }

  return { valid: true };
}
