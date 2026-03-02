import { describe, it, expect } from 'vitest';
import { agentKeyToRawEd25519Base64url } from '../../src/utils.js';
import { fakeAgentKey } from '../helpers.js';

describe('agentKeyToRawEd25519Base64url', () => {
  it('extracts bytes 3-34 from a valid agent key and base64url-encodes them', () => {
    const agentKey = fakeAgentKey(0);
    const result = agentKeyToRawEd25519Base64url(agentKey);

    // The fakeAgentKey fills bytes i=3..38 with (0 + i) & 0xff
    const expectedBytes = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      expectedBytes[i] = (3 + i) & 0xff;
    }
    expect(result).toBe(Buffer.from(expectedBytes).toString('base64url'));
  });

  it('produces different output for different seeds', () => {
    const a = agentKeyToRawEd25519Base64url(fakeAgentKey(0));
    const b = agentKeyToRawEd25519Base64url(fakeAgentKey(1));
    expect(a).not.toBe(b);
  });

  it('output is 43 characters (32 bytes base64url no-padding)', () => {
    const result = agentKeyToRawEd25519Base64url(fakeAgentKey(0));
    // ceil(32 * 4 / 3) = 43 chars, no padding
    expect(result).toHaveLength(43);
    expect(result).not.toContain('=');
  });

  it('uses URL-safe alphabet (no + or /)', () => {
    // Run across multiple seeds to be confident
    for (let seed = 0; seed < 20; seed++) {
      const result = agentKeyToRawEd25519Base64url(fakeAgentKey(seed));
      expect(result).not.toContain('+');
      expect(result).not.toContain('/');
    }
  });

  it('throws on invalid-length input', () => {
    const short = Buffer.from(new Uint8Array(10)).toString('base64');
    expect(() => agentKeyToRawEd25519Base64url(short)).toThrow('39 bytes');
  });
});
