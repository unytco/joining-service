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
import {
  decodeHashFromBase64,
  encodeHashToBase64,
  agentPubKeyFrom32,
} from '../utils.js';

/**
 * Membrane proof generator backed by a LairClient.
 *
 * Produces proofs matching the Holochain SerializedBytes envelope pattern:
 *
 *   Rust target structs:
 *     struct MembraneProofData {
 *       for_agent: AgentPubKey,   // 39-byte binary in msgpack
 *       dna_hash: DnaHash,        // 39-byte binary in msgpack
 *       timestamp: String,
 *       nonce: String,
 *     }
 *     struct MembraneProofEnvelope {
 *       signature: Signature,     // 64-byte binary in msgpack
 *       data: MembraneProofData,
 *       signer: AgentPubKey,      // 39-byte binary in msgpack
 *     }
 *
 * The zome deserializes via MembraneProofEnvelope::try_from(SerializedBytes)
 * and verifies the signature using verify_signature(signer, sig, data).
 */
export class LairProofGenerator implements MembraneProofGenerator {
  /** The signer's 39-byte AgentPubKey (prefix + ed25519 + DHT location). */
  readonly signerAgentPubKey: Uint8Array;
  /** The signer's AgentPubKey in HoloHash base64 ("u" + base64url). */
  readonly signerAgentPubKeyB64: string;

  private constructor(
    private client: ILairClient,
    private rawPubKey: Uint8Array,
  ) {
    this.signerAgentPubKey = agentPubKeyFrom32(rawPubKey);
    this.signerAgentPubKeyB64 = encodeHashToBase64(this.signerAgentPubKey);
  }

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
  ): Promise<Record<string, Uint8Array>> {
    const proofs: Record<string, Uint8Array> = {};

    // Decode the agent key to raw 39-byte AgentPubKey
    const agentKeyBytes = decodeHashFromBase64(agentKey);

    for (const dnaHash of dnaHashes) {
      const nonce = randomBytes(16).toString('hex');
      const timestamp = new Date().toISOString();

      // Decode DNA hash to raw 39-byte DnaHash
      const dnaHashBytes = decodeHashFromBase64(dnaHash);

      // Data struct: fields must match Rust struct declaration order exactly
      // so that rmp_serde::to_vec_named produces identical bytes for
      // verify_signature to work cross-language.
      const data = {
        for_agent: agentKeyBytes,
        dna_hash: dnaHashBytes,
        timestamp,
        nonce,
      };

      const dataBytes = encode(data);
      const signature = await this.client.signByPubKey(
        this.rawPubKey,
        dataBytes,
      );

      // Envelope struct: matches Rust MembraneProofEnvelope field order
      const envelope = {
        signature,
        data,
        signer: this.signerAgentPubKey,
      };

      proofs[dnaHash] = encode(envelope);
    }

    return proofs;
  }
}
