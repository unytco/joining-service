#!/usr/bin/env tsx
/**
 * Generate a membrane proof signing key pair for the joining service.
 *
 * Outputs:
 *   - A 64-character hex seed  → store securely (Vault, secrets manager, 600-perm file)
 *   - An AgentPubKey string    → embed as the progenitor in the DNA manifest/properties
 *
 * The seed and the public key are permanently coupled.  The progenitor must be
 * embedded in the DNA *before* the hApp bundle is compiled.  After compilation
 * neither can be changed without rebuilding the bundle.
 *
 * Usage:
 *   npm run gen-signing-key
 *
 * The npm script passes NODE_OPTIONS=--preserve-symlinks so that Node resolves
 * transitive dependencies (libsodium-wrappers) through the symlinked file:
 * path rather than the physical lair package directory, where they are not
 * installed.  This flag can be dropped once @holo-host/lair is published to
 * npm and installed as a normal package dependency.
 */

import { randomBytes } from 'node:crypto';
import { seedToStoredEntry } from '@holo-host/lair';
import { agentPubKeyFrom32, encodeHashToBase64 } from '../src/utils.js';

const seed = randomBytes(32);

// Derive ed25519 public key via the same libsodium path used by LairProofGenerator.
const entry = await seedToStoredEntry(seed, 'membrane-proof-signer');
const pubKeyBytes = entry.info.ed25519_pub_key; // 32 bytes

// Wrap into a 39-byte AgentPubKey with correct blake2b DHT location
const agentPubKey = agentPubKeyFrom32(pubKeyBytes);
const agentPubKeyB64 = encodeHashToBase64(agentPubKey);
const seedHex = Buffer.from(seed).toString('hex');

console.log('='.repeat(72));
console.log('MEMBRANE PROOF SIGNING KEY');
console.log('='.repeat(72));
console.log();
console.log('Seed (KEEP SECRET — store in Vault / secrets manager / 600-perm file):');
console.log(seedHex);
console.log();
console.log('AgentPubKey (embed as progenitor in DNA properties before compiling):');
console.log(agentPubKeyB64);
console.log();
console.log('These two values are permanently linked.  Do not regenerate unless');
console.log('you are also rebuilding the hApp bundle with a new progenitor.');
console.log('='.repeat(72));
