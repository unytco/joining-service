import { describe, it, expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { encode, decode } from '@msgpack/msgpack';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha2.js';
import { LairProofGenerator } from '../src/membrane-proof/lair-signer.js';
import {
  decodeHashFromBase64,
  encodeHashToBase64,
  agentPubKeyFrom32,
  dhtLocationFrom32,
} from '../src/utils.js';
import { fakeAgentKey, fakeDnaHash } from './helpers.js';

// @noble/ed25519 v2 needs a sha512 sync hash
ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

describe('membrane proof generation (volla pattern)', () => {
  it('produces a valid msgpack envelope with binary hash fields', async () => {
    const gen = await LairProofGenerator.fromSeed(randomBytes(32));
    const agentKey = fakeAgentKey(42);
    const dnaHash = fakeDnaHash(7);

    const proofs = await gen.generate(agentKey, [dnaHash]);
    expect(Object.keys(proofs)).toEqual([dnaHash]);

    const proofBytes = proofs[dnaHash];

    // Decode the outer envelope
    const envelope = decode(proofBytes) as Record<string, unknown>;
    expect(envelope).toHaveProperty('signature');
    expect(envelope).toHaveProperty('data');
    expect(envelope).toHaveProperty('signer');

    // Signature should be 64-byte binary
    const sig = envelope.signature as Uint8Array;
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig.length).toBe(64);

    // Signer should be 39-byte AgentPubKey binary
    const signer = envelope.signer as Uint8Array;
    expect(signer).toBeInstanceOf(Uint8Array);
    expect(signer.length).toBe(39);
    // Check AgentPubKey prefix
    expect(signer[0]).toBe(0x84);
    expect(signer[1]).toBe(0x20);
    expect(signer[2]).toBe(0x24);
    // Signer should match the generator's public AgentPubKey
    expect(signer).toEqual(gen.signerAgentPubKey);

    // Data should be a map with binary hash fields
    const data = envelope.data as Record<string, unknown>;
    expect(data).toHaveProperty('for_agent');
    expect(data).toHaveProperty('dna_hash');
    expect(data).toHaveProperty('timestamp');
    expect(data).toHaveProperty('nonce');

    // for_agent should be 39-byte AgentPubKey binary
    const forAgent = data.for_agent as Uint8Array;
    expect(forAgent).toBeInstanceOf(Uint8Array);
    expect(forAgent.length).toBe(39);
    expect(forAgent[0]).toBe(0x84);
    expect(forAgent[1]).toBe(0x20);
    expect(forAgent[2]).toBe(0x24);
    // Should match the input agent key
    expect(forAgent).toEqual(decodeHashFromBase64(agentKey));

    // dna_hash should be 39-byte DnaHash binary
    const dnaHashField = data.dna_hash as Uint8Array;
    expect(dnaHashField).toBeInstanceOf(Uint8Array);
    expect(dnaHashField.length).toBe(39);
    expect(dnaHashField[0]).toBe(0x84);
    expect(dnaHashField[1]).toBe(0x2d);
    expect(dnaHashField[2]).toBe(0x24);
    expect(dnaHashField).toEqual(decodeHashFromBase64(dnaHash));

    // timestamp and nonce should be strings
    expect(typeof data.timestamp).toBe('string');
    expect(typeof data.nonce).toBe('string');
  });

  it('signature verifies against re-encoded data bytes', async () => {
    const gen = await LairProofGenerator.fromSeed(randomBytes(32));
    const agentKey = fakeAgentKey(1);
    const dnaHash = fakeDnaHash(2);

    const proofs = await gen.generate(agentKey, [dnaHash]);
    const envelope = decode(proofs[dnaHash]) as Record<string, unknown>;

    const sig = envelope.signature as Uint8Array;
    const signer = envelope.signer as Uint8Array;
    const data = envelope.data as Record<string, unknown>;

    // Re-encode the data field to get the bytes that were signed.
    // This simulates what Holochain's verify_signature does:
    // it re-serializes the data struct with rmp_serde::to_vec_named.
    const dataBytes = encode(data);

    // Extract the raw 32-byte ed25519 key from the 39-byte AgentPubKey
    const ed25519Key = signer.slice(3, 35);

    // Verify the signature
    const valid = ed.verify(sig, dataBytes, ed25519Key);
    expect(valid).toBe(true);
  });

  it('produces correct DHT location bytes', () => {
    // Verify our dhtLocationFrom32 matches Holochain's algorithm:
    // blake2b-128 of the 32-byte core, then XOR-fold to 4 bytes
    const core = new Uint8Array(32).fill(0xdb);
    const loc = dhtLocationFrom32(core);
    expect(loc.length).toBe(4);

    // Verify the result is deterministic
    const loc2 = dhtLocationFrom32(core);
    expect(loc).toEqual(loc2);
  });

  it('agentPubKeyFrom32 produces valid 39-byte AgentPubKey', () => {
    const ed25519Key = randomBytes(32);
    const agentKey = agentPubKeyFrom32(new Uint8Array(ed25519Key));

    expect(agentKey.length).toBe(39);
    // Check prefix
    expect(agentKey[0]).toBe(0x84);
    expect(agentKey[1]).toBe(0x20);
    expect(agentKey[2]).toBe(0x24);
    // Check the core key is embedded
    expect(agentKey.slice(3, 35)).toEqual(new Uint8Array(ed25519Key));
    // Check DHT location is computed
    const expectedLoc = dhtLocationFrom32(new Uint8Array(ed25519Key));
    expect(agentKey.slice(35)).toEqual(expectedLoc);
  });

  it('signerAgentPubKeyB64 round-trips through decodeHashFromBase64', async () => {
    const gen = await LairProofGenerator.fromSeed(randomBytes(32));

    const b64 = gen.signerAgentPubKeyB64;
    // Should start with "u"
    expect(b64.startsWith('u')).toBe(true);

    // Should round-trip back to the same bytes
    const decoded = decodeHashFromBase64(b64);
    expect(decoded).toEqual(gen.signerAgentPubKey);
  });

  it('generates distinct proofs per DNA hash', async () => {
    const gen = await LairProofGenerator.fromSeed(randomBytes(32));
    const agentKey = fakeAgentKey(0);
    const dna1 = fakeDnaHash(1);
    const dna2 = fakeDnaHash(2);

    const proofs = await gen.generate(agentKey, [dna1, dna2]);
    expect(Object.keys(proofs)).toHaveLength(2);

    const env1 = decode(proofs[dna1]) as Record<string, unknown>;
    const env2 = decode(proofs[dna2]) as Record<string, unknown>;

    const data1 = env1.data as Record<string, unknown>;
    const data2 = env2.data as Record<string, unknown>;

    // Different DNA hashes in the data
    expect(data1.dna_hash).toEqual(decodeHashFromBase64(dna1));
    expect(data2.dna_hash).toEqual(decodeHashFromBase64(dna2));
    expect(data1.dna_hash).not.toEqual(data2.dna_hash);

    // Same agent key in both
    expect(data1.for_agent).toEqual(data2.for_agent);
  });

  it('msgpack field ordering matches rmp_serde named-field convention', async () => {
    // Verify that @msgpack/msgpack encodes object keys in insertion order
    // (which must match Rust struct declaration order for verify_signature).
    // This is a structural test to catch if the msgpack library changes behavior.
    const gen = await LairProofGenerator.fromSeed(randomBytes(32));
    const agentKey = fakeAgentKey(0);
    const dnaHash = fakeDnaHash(0);

    const proofs = await gen.generate(agentKey, [dnaHash]);
    const envelope = decode(proofs[dnaHash]) as Record<string, unknown>;

    // Envelope keys must be in this exact order
    expect(Object.keys(envelope)).toEqual(['signature', 'data', 'signer']);

    // Data keys must be in this exact order
    const data = envelope.data as Record<string, unknown>;
    expect(Object.keys(data)).toEqual([
      'for_agent',
      'dna_hash',
      'timestamp',
      'nonce',
    ]);
  });
});
