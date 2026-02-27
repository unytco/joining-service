import { randomBytes } from 'node:crypto';
import { encode } from '@msgpack/msgpack';
import {
  createLairClient,
  MemoryKeyStorage,
  seedToStoredEntry,
  hexToSeed,
} from '@holo-host/lair';
import type { ILairClient } from '@holo-host/lair';
import type { MembraneProofGenerator } from './generator.js';

/**
 * Membrane proof generator backed by a LairClient.
 *
 * Uses the lair keystore for signing instead of raw @noble/ed25519,
 * ensuring key format compatibility with the HWC browser extension.
 */
export class LairProofGenerator implements MembraneProofGenerator {
  private constructor(
    private client: ILairClient,
    private pubKey: Uint8Array,
  ) {}

  /**
   * Create a generator from a 32-byte ed25519 seed.
   */
  static async fromSeed(
    seed: Uint8Array,
    tag = 'membrane-proof-signer',
  ): Promise<LairProofGenerator> {
    const storage = new MemoryKeyStorage();
    await storage.init();

    const entry = await seedToStoredEntry(seed, tag);
    await storage.putEntry(entry);

    const client = await createLairClient(storage);

    return new LairProofGenerator(client, entry.info.ed25519_pub_key);
  }

  /**
   * Create a generator from a hex-encoded ed25519 seed.
   * Accepts the same format as signing-key.pem files.
   */
  static async fromHex(
    hex: string,
    tag = 'membrane-proof-signer',
  ): Promise<LairProofGenerator> {
    return LairProofGenerator.fromSeed(hexToSeed(hex), tag);
  }

  async generate(
    agentKey: string,
    dnaHashes: string[],
    metadata?: Record<string, unknown>,
  ): Promise<Record<string, Uint8Array>> {
    const proofs: Record<string, Uint8Array> = {};

    for (const dnaHash of dnaHashes) {
      const nonce = randomBytes(16).toString('hex');
      const timestamp = new Date().toISOString();

      const payload = {
        agent_key: agentKey,
        dna_hash: dnaHash,
        timestamp,
        nonce,
        ...metadata,
      };

      const payloadBytes = encode(payload);
      const signature = await this.client.signByPubKey(
        this.pubKey,
        payloadBytes,
      );

      const proof = encode({
        payload,
        signature,
        signer_pub_key: this.pubKey,
      });

      proofs[dnaHash] = proof;
    }

    return proofs;
  }
}
