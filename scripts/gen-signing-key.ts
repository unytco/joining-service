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

const seed = randomBytes(32);

// Derive ed25519 public key via the same libsodium path used by LairProofGenerator.
const entry = await seedToStoredEntry(seed, 'membrane-proof-signer');
const pubKeyBytes = entry.info.ed25519_pub_key; // 32 bytes

// Wrap into a Holochain AgentPubKey (39-byte HoloHash):
//   [0x84, 0x20, 0x24]  agent-pub-key type prefix   (3 bytes)
//   <ed25519 public key>                             (32 bytes)
//   <DHT location>       XOR-fold of the 35 bytes   (4 bytes)
//
// The DHT location is computed by XOR-folding the 35-byte prefixed array into
// 4-byte lanes, matching Holochain's HoloHash::new() implementation.
const prefixed = new Uint8Array(35);
prefixed[0] = 0x84;
prefixed[1] = 0x20;
prefixed[2] = 0x24;
prefixed.set(pubKeyBytes, 3);

const loc = new Uint8Array(4);
for (let i = 0; i < prefixed.length; i++) {
  loc[i % 4] ^= prefixed[i];
}

const agentPubKey = new Uint8Array(39);
agentPubKey.set(prefixed);
agentPubKey.set(loc, 35);

// Encode as the Holochain base64url format used by encodeHashToBase64():
// prefix "uhCAk" is the base64url of the 3-byte type prefix, then the rest.
const b64url = Buffer.from(agentPubKey)
  .toString('base64')
  .replace(/\+/g, '-')
  .replace(/\//g, '_')
  .replace(/=+$/, '');

const seedHex = Buffer.from(seed).toString('hex');

console.log('='.repeat(72));
console.log('MEMBRANE PROOF SIGNING KEY');
console.log('='.repeat(72));
console.log();
console.log('Seed (KEEP SECRET — store in Vault / secrets manager / 600-perm file):');
console.log(seedHex);
console.log();
console.log('AgentPubKey (embed as progenitor in DNA properties before compiling):');
console.log('u' + b64url); // 'u' is the base64url multi-base prefix; rest is base64url(39 bytes)
console.log();
console.log('These two values are permanently linked.  Do not regenerate unless');
console.log('you are also rebuilding the hApp bundle with a new progenitor.');
console.log('='.repeat(72));
