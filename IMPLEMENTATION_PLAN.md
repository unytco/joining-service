# Joining Service Implementation Plan

**Date**: 2026-02-24
**Status**: Draft

## Overview

This plan covers three deliverables that work together: client library changes in HWC, extension plumbing for membrane proofs, and a reference joining service implementation.

---

## Phase 1: HWC Client Library (`packages/client/`)

### 1.1 New `JoiningClient` class

**New file**: `packages/client/src/joining.ts`

A standalone class that handles the full discovery-join-verify-credentials flow against any joining service. Usable independently or orchestrated by `WebConductorAppClient`.

```
JoiningClient
  ├── static discover(appDomain: string): Promise<JoiningClient>
  ├── static fromUrl(joiningServiceUrl: string): Promise<JoiningClient>
  ├── getInfo(): Promise<JoiningServiceInfo>
  ├── join(agentKey: string, claims?): Promise<JoinSession>
  ├── reconnect(agentKey: string, signTimestamp: (ts: string) => Promise<Uint8Array>): Promise<ReconnectResponse>
  └── (internal HTTP methods)

JoinSession
  ├── sessionToken: string
  ├── status: 'ready' | 'pending' | 'rejected'
  ├── challenges?: Challenge[]
  ├── verify(challengeId: string, response: string): Promise<JoinSession>
  ├── pollStatus(): Promise<JoinSession>
  └── getCredentials(): Promise<JoinCredentials>
```

Key decisions:
- Uses `fetch()` internally (available in all modern browsers)
- Immutable session objects — `verify()` and `pollStatus()` return new `JoinSession` instances
- Exports all TypeScript types from `JOINING_SERVICE_API.md` Section 9 (including `ReconnectRequest`, `ReconnectResponse`)
- Includes a `JoiningError` class wrapping the API error format
- `reconnect()` accepts a signing callback so the client controls key access — the `JoiningClient` generates the ISO 8601 timestamp, passes it to the callback to get an ed25519 signature, then POSTs to `/v1/reconnect`

### 1.2 Type additions — PARTIALLY DONE

**`packages/client/src/types.ts`** — membrane proof types already exist:
- `InstallAppRequest` already has `membraneProofs?: Record<string, Uint8Array | number[]>` (per-role, keyed by role name)
- `HolochainAPI` already has `provideMemproofs(params: { contextId?: string; memproofs: Record<string, Uint8Array | number[]> })`

**Still needed**:
- Add `dnaModifiers?: { networkSeed?: string; properties?: Record<string, unknown> }` to `InstallAppRequest` (for joining service to pass DNA modifiers through install)

### 1.3 WebConductorAppClient integration

**Modified file**: `packages/client/src/WebConductorAppClient.ts`

Extend `WebConductorAppClientOptions`:
```typescript
interface WebConductorAppClientOptions extends ConnectionConfig {
  // Existing:
  roleName?: string;
  happBundlePath?: string;

  // New:
  joiningServiceUrl?: string;   // Explicit joining service URL
  autoDiscover?: boolean;       // Discover from current domain's .well-known
  onChallenge?: (challenge: Challenge) => Promise<string>;  // UI callback for verification
  membraneProofs?: Record<string, Uint8Array>;  // Pre-obtained membrane proofs (bypass joining service)
}
```

Note: The extension API uses `Record<string, Uint8Array>` keyed by role name. The joining service returns `membrane_proofs` as `Record<DnaHash, base64-string>` keyed by DnaHash. The client must map DnaHash keys to role names (using the hApp manifest or the `dna_hashes` from `/v1/info`) and base64-decode the values to `Uint8Array` before passing to `installHapp()`.

Update `connect()` flow:
1. If `autoDiscover` or `joiningServiceUrl` provided, use `JoiningClient`
2. Generate agent key (existing flow via `window.holochain.connect()`)
3. Call `join()` with agent key + any claims
4. If join returns `409 agent_already_joined`, call `reconnect()` instead to get fresh URLs
5. If pending, invoke `onChallenge` callback for each challenge
6. Get credentials; for each entry in `membrane_proofs` (keyed by DnaHash), base64-decode the proof to `Uint8Array` and map the DnaHash key to the corresponding role name, producing `Record<string, Uint8Array>` for the extension API
7. Call `installHapp({ bundle, membraneProofs })` — uses the one-step flow (genesis runs immediately since proofs are provided at install time)
8. Configure linker URL from credentials
9. Fall back to existing direct `linkerUrl` flow if no joining service configured

Add `reconnect()` method:
- Called when the client already has an installed hApp but needs updated linker/gateway URLs
- Uses the agent's ed25519 key (available via the extension's key management) to sign the timestamp
- Returns updated `linker_urls`, `http_gateways`, and `linker_urls_expire_at`
- The client should call this proactively when `linker_urls_expire_at` is approaching, or reactively when a linker connection fails

### 1.4 HTTP Gateway proxy (R/O mode)

**New file**: `packages/client/src/gateway-proxy.ts`

A thin wrapper that routes `callZome` requests to an hc-http-gw instance. Used before the user has joined (browse-before-join UX).

```
GatewayProxy
  ├── constructor(gatewayUrl: string, dnaHashes: string[])
  ├── callZome(params: CallZomeRequest): Promise<unknown>
  └── isAvailable(): boolean
```

The `WebConductorAppClient` can use this as a fallback when the extension is not yet connected.

### 1.5 Exports

**Modified file**: `packages/client/src/index.ts`

Export: `JoiningClient`, `JoinSession`, `GatewayProxy`, all joining types.

---

## Phase 2: Extension Plumbing — COMPLETE

All membrane proof plumbing is already implemented in `holo-web-conductor`. No further extension changes are needed for the joining service. Summary of existing implementation:

### 2.1 Membrane proof in install flow — DONE

**`packages/extension/src/background/index.ts`** (lines 847–890):
- `INSTALL_HAPP` handler normalizes `membraneProofs` from `Record<string, Uint8Array | number[]>` to `Record<string, Uint8Array>`
- If proofs provided at install time AND app has `allow_deferred_memproofs=true`, genesis runs immediately (one-step flow)
- If proofs not provided, context enters `awaitingMemproofs` status (deferred flow)

**`packages/extension/src/background/index.ts`** (lines 1030–1068):
- `PROVIDE_MEMPROOFS` handler accepts deferred proofs, runs genesis for each DNA, transitions context to `enabled`

**`packages/extension/src/lib/happ-context-manager.ts`**:
- `installHapp()` checks `allow_deferred_memproofs` manifest flag to determine initial status
- `provideMemproofs(contextId, memproofs)` validates context is in `awaitingMemproofs` state
- `completeMemproofs(contextId)` transitions status to `enabled` after genesis succeeds

### 2.2 Genesis membrane proof — DONE

**`packages/core/src/storage/genesis.ts`** (lines 53–128):
- `initializeGenesis(storage, dnaHash, agentPubKey, membraneProof?)` threads proof into `AgentValidationPkg` action
- Proof is included in the signed action and stored in the source chain

**`packages/core/src/ribosome/genesis-self-check.ts`** (lines 49–164):
- `runGenesisSelfCheck(dnaManifest, cellId, membraneProof?)` passes proof to WASM `genesis_self_check` callback
- Proof serialized as msgpack `GenesisSelfCheckDataV2 { membrane_proof, agent_key }`

### 2.3 Storage — DONE

- **SQLite**: `membrane_proof BLOB` column in actions table (`packages/core/src/storage/sqlite-schema.ts`)
- **IndexedDB**: `membraneProof?: number[]` on `StorableAction` (`packages/core/src/storage/types.ts`)
- **In-memory**: `membraneProof?: Uint8Array` on `AgentValidationPkgAction`

### 2.4 Message passing — DONE

**`packages/extension/src/lib/messaging.ts`**:
- `MessageType.PROVIDE_MEMPROOFS` message type
- `ProvideMemproofsPayload { contextId: string; memproofs: Record<string, Uint8Array> }`
- Chrome message boundaries handled via existing `toUint8Array()` normalization

### Key design detail: per-role membrane proofs

The extension uses `Record<string, Uint8Array>` keyed by role name, not a single proof. A hApp with multiple DNAs can have a different membrane proof per role. The joining service's `membrane_proofs` field returns `Record<DnaHash, base64-string>` — one entry per DNA that requires a proof. The client maps DnaHash keys to role names before passing to the extension.

### Two installation flows

1. **One-step**: `installHapp({ bundle, membraneProofs })` → genesis runs immediately → `enabled`
2. **Deferred**: `installHapp({ bundle })` → `awaitingMemproofs` → later `provideMemproofs({ contextId, memproofs })` → genesis → `enabled`

The joining service integration will use the one-step flow: credentials are obtained before install, so proofs are available at install time.

---

## Phase 3: Reference Joining Service

### 3.1 Project setup

**New package**: `joining-service/` (this directory, sibling to `holo-web-conductor/`)

Technology: Node.js + Hono (lightweight, runs on Cloudflare Workers, Node, Deno, Bun). Alternative: Express for familiarity.

```
joining-service/
├── src/
│   ├── index.ts              # Server entry, route registration
│   ├── routes/
│   │   ├── info.ts           # GET /v1/info
│   │   ├── join.ts           # POST /v1/join
│   │   ├── verify.ts         # POST /v1/join/:session/verify
│   │   ├── status.ts         # GET /v1/join/:session/status
│   │   ├── credentials.ts    # GET /v1/join/:session/credentials
│   │   └── reconnect.ts      # POST /v1/reconnect
│   ├── auth-methods/
│   │   ├── open.ts           # No-op auth
│   │   ├── email-code.ts     # Email verification
│   │   ├── invite-code.ts    # Pre-issued invite codes
│   │   └── evm-signature.ts  # EVM wallet signing
│   ├── session/
│   │   ├── store.ts          # Session storage interface
│   │   ├── memory-store.ts   # In-memory implementation
│   │   └── redis-store.ts    # Redis implementation (optional)
│   ├── membrane-proof/
│   │   ├── generator.ts      # Membrane proof generation interface
│   │   └── ed25519-signer.ts # Simple Ed25519-based proof generator
│   ├── config.ts             # Service configuration
│   └── middleware/
│       ├── cors.ts
│       └── rate-limit.ts
├── test/
│   ├── open-join.test.ts
│   ├── email-verification.test.ts
│   ├── invite-code.test.ts
│   └── reconnect.test.ts
├── package.json
├── tsconfig.json
└── README.md
```

### 3.2 Configuration

The reference server is configured via a JSON config file or environment variables:

```json
{
  "happ": {
    "id": "mewsfeed",
    "name": "Mewsfeed",
    "happ_bundle_url": "https://app.example.com/mewsfeed.happ"
  },
  "auth_methods": ["email_code"],
  "linker_urls": [
    "wss://linker1.example.com:8090"
  ],
  "membrane_proof": {
    "enabled": true,
    "signing_key_path": "./signing-key.pem"
  },
  "email": {
    "provider": "postmark",
    "api_key": "...",
    "from": "noreply@example.com",
    "template": "Your verification code is: {{code}}"
  },
  "session": {
    "store": "memory",
    "pending_ttl_seconds": 3600,
    "ready_ttl_seconds": 86400
  },
  "linker_urls_expire_after_seconds": 21600,
  "reconnect": {
    "enabled": true,
    "timestamp_tolerance_seconds": 300
  }
}
```

### 3.3 Auth method plugin interface

```typescript
interface AuthMethodPlugin {
  type: string;

  // Called during POST /join to determine what challenges to create
  createChallenges(
    agentKey: string,
    claims: Record<string, string>,
    config: unknown
  ): Promise<Challenge[]>;

  // Called during POST /join/:session/verify
  verifyChallengeResponse(
    challenge: Challenge,
    response: string,
    claims: Record<string, string>
  ): Promise<{ passed: boolean; reason?: string }>;
}
```

This allows hApp developers to add custom auth methods by implementing the plugin interface.

### 3.4 Membrane proof generation

The reference implementation uses Ed25519 signing. The generator produces a proof per DNA, keyed by DnaHash:

```typescript
interface MembraneProofGenerator {
  // Generate proofs for all DNAs that require them
  generate(
    agentKey: string,
    dnaHashes: string[],
    metadata?: Record<string, unknown>
  ): Promise<Record<string, Uint8Array>>;
  // Returns Record<DnaHash, proof bytes>
}
```

Default implementation (per DNA):
1. Create payload: `{ agent_key, dna_hash, timestamp, nonce }`
2. Sign with the service's Ed25519 key
3. Return msgpack-encoded `{ payload, signature, signer_pub_key }`

The DNA's `genesis_self_check` validates by checking the signature against the signer pub key stored in DNA properties. Each DNA validates its own proof independently.

---

## Phase Ordering and Dependencies

```
Phase 2 (Extension plumbing)           ──  COMPLETE

Phase 1.1 (JoiningClient)             ──► Phase 1.3 (WebConductorAppClient)
                                       ──► Phase 3 (Reference Server)

Phase 1.2 (dnaModifiers type)         ──► Phase 1.3

Phase 3.1-3.4 (Reference Server)      ──► Integration testing
```

Phase 2 is done. Phase 1.1 and Phase 3 can proceed in parallel. Phase 1.3 depends on 1.1 completing. Phase 1.2 is a small type addition that can be done alongside 1.1.

---

## Verification Strategy

### Unit Tests
- `JoiningClient`: Mock HTTP responses, test all status transitions (ready, pending, rejected), challenge flows, error handling
- `JoiningClient.reconnect()`: Test signature generation callback, timestamp validation, successful reconnect, error cases (agent not joined, bad signature)
- `JoinSession`: Test immutability, verify/poll/getCredentials methods
- `GatewayProxy`: Mock gateway responses
- Reference server routes: Test each endpoint with various auth methods
- Reconnect route: Test ed25519 signature verification, timestamp drift rejection, agent-not-joined guard

### Integration Tests
- Reference server + `JoiningClient`: End-to-end join flow
- Open auth: join → credentials in 2 calls
- Email auth: join → verify → credentials
- Invite code: join with valid/invalid code
- Reconnect: join → use credentials → reconnect with signature → receive updated URLs
- Reconnect after expiry: verify client gets fresh linker URLs with new `linker_urls_expire_at`

### E2E Tests
- Full browser flow: extension + joining service + linker
- Test `.well-known` discovery
- Test membrane proof threading through install and genesis
- Test R/O gateway fallback before join
- Test reconnect flow: install hApp, simulate linker URL expiry, reconnect, verify new linker connection

---

## Critical Files Reference

| File | Phase | Status | Change |
|------|-------|--------|--------|
| `packages/client/src/joining.ts` | 1.1 | TODO | New: JoiningClient, JoinSession, reconnect() |
| `packages/client/src/gateway-proxy.ts` | 1.4 | TODO | New: GatewayProxy |
| `packages/client/src/types.ts` | 1.2 | PARTIAL | `membraneProofs` done; add `dnaModifiers` to InstallAppRequest |
| `packages/client/src/WebConductorAppClient.ts` | 1.3 | TODO | Extend options, update connect(), add reconnect() |
| `packages/client/src/index.ts` | 1.5 | TODO | Export new modules |
| `packages/extension/src/background/index.ts` | 2.1 | DONE | Handles membraneProofs in install + PROVIDE_MEMPROOFS |
| `packages/extension/src/lib/happ-context-manager.ts` | 2.1 | DONE | installHapp, provideMemproofs, completeMemproofs |
| `packages/core/src/storage/genesis.ts` | 2.2 | DONE | initializeGenesis accepts membraneProof, threads into AgentValidationPkg |
| `packages/core/src/ribosome/genesis-self-check.ts` | 2.2 | DONE | runGenesisSelfCheck passes proof to WASM |
| `packages/core/src/storage/types.ts` | 2.3 | DONE | AgentValidationPkgAction.membraneProof, StorableAction serialization |
| `packages/extension/src/lib/messaging.ts` | 2.4 | DONE | PROVIDE_MEMPROOFS message type + payload |
