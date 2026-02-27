import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { JoiningClient, JoiningError } from '../../src/client/index.js';
import { startE2EServer, type E2EServer } from './helpers.js';
import * as ed from '@noble/ed25519';

// Generate a real ed25519 keypair and encode as a valid 39-byte AgentPubKey
async function generateAgentKeypair(): Promise<{
  agentKey: string;
  privateKey: Uint8Array;
}> {
  const privateKey = ed.utils.randomPrivateKey();
  const publicKey = await ed.getPublicKeyAsync(privateKey);

  // Build 39-byte AgentPubKey: [0x84, 0x20, 0x24] + 32-byte pubkey + 4-byte DHT location
  const agentKeyBytes = new Uint8Array(39);
  agentKeyBytes[0] = 0x84;
  agentKeyBytes[1] = 0x20;
  agentKeyBytes[2] = 0x24;
  agentKeyBytes.set(publicKey, 3);
  // DHT location bytes (arbitrary for testing)
  agentKeyBytes[35] = 0x00;
  agentKeyBytes[36] = 0x00;
  agentKeyBytes[37] = 0x00;
  agentKeyBytes[38] = 0x00;

  return {
    agentKey: Buffer.from(agentKeyBytes).toString('base64'),
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

    expect(result.linker_urls).toEqual(['wss://linker.example.com:8090']);
    expect(result.linker_urls_expire_at).toBeTruthy();
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
