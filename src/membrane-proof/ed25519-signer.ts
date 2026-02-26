import { randomBytes } from 'node:crypto';
import * as ed from '@noble/ed25519';
import { encode } from '@msgpack/msgpack';
import type { MembraneProofGenerator } from './generator.js';

export class Ed25519ProofGenerator implements MembraneProofGenerator {
  private privateKey: Uint8Array;
  private publicKey: Uint8Array | null = null;

  constructor(privateKey: Uint8Array) {
    this.privateKey = privateKey;
  }

  private async getPublicKey(): Promise<Uint8Array> {
    if (!this.publicKey) {
      this.publicKey = await ed.getPublicKeyAsync(this.privateKey);
    }
    return this.publicKey;
  }

  async generate(
    agentKey: string,
    dnaHashes: string[],
    metadata?: Record<string, unknown>,
  ): Promise<Record<string, Uint8Array>> {
    const signerPubKey = await this.getPublicKey();
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
      const signature = await ed.signAsync(payloadBytes, this.privateKey);

      const proof = encode({
        payload,
        signature,
        signer_pub_key: signerPubKey,
      });

      proofs[dnaHash] = proof;
    }

    return proofs;
  }

  static async generateKeyPair(): Promise<{
    privateKey: Uint8Array;
    publicKey: Uint8Array;
  }> {
    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = await ed.getPublicKeyAsync(privateKey);
    return { privateKey, publicKey };
  }
}
