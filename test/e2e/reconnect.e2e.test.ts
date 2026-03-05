import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { JoiningClient, JoiningError } from '../../src/client/index.js';
import { startE2EServer, type E2EServer } from './helpers.js';
import * as ed from '@noble/ed25519';
import { encodeHashToBase64, agentPubKeyFrom32 } from '../../src/utils.js';

// Generate a real ed25519 keypair and encode as a valid 39-byte AgentPubKey
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

describe('E2E: Reconnect flow', () => {
  let server: E2EServer;
  let client: JoiningClient;

  beforeAll(async () => {
    server = await startE2EServer({
      auth_methods: ['open'],
      reconnect: { enabled: true },
    });
    client = JoiningClient.fromUrl(`${server.baseUrl}/v1`);
  });

  afterAll(async () => {
    await server.close();
  });

  it('reconnect after successful join returns fresh URLs', async () => {
    const { agentKey, privateKey } = await generateAgentKeypair();

    // First join
    const session = await client.join(agentKey);
    expect(session.status).toBe('ready');

    // Reconnect with real ed25519 signature
    const result = await client.reconnect(
      agentKey,
      async (timestamp: string) => {
        const msgBytes = new TextEncoder().encode(timestamp);
        return ed.signAsync(msgBytes, privateKey);
      },
    );

    expect(result.linker_urls).toEqual([{ url: 'wss://linker.example.com:8090' }]);
  });

  it('reconnect for unknown agent throws agent_not_joined', async () => {
    const { agentKey, privateKey } = await generateAgentKeypair();

    try {
      await client.reconnect(agentKey, async (timestamp: string) => {
        const msgBytes = new TextEncoder().encode(timestamp);
        return ed.signAsync(msgBytes, privateKey);
      });
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(JoiningError);
      expect((e as JoiningError).code).toBe('agent_not_joined');
    }
  });
});
