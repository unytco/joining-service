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
- Exports all TypeScript types from `JOINING_SERVICE_API.md` Section 9
- Includes a `JoiningError` class wrapping the API error format

### 1.2 Type additions

**Modified file**: `packages/client/src/types.ts`

- Add `membraneProof?: Uint8Array | number[]` to `InstallAppRequest`
- Add `dnaModifiers?: { networkSeed?: string; properties?: Record<string, unknown> }` to `InstallAppRequest`

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
  membraneProof?: Uint8Array;   // Pre-obtained membrane proof (bypass joining service)
}
```

Update `connect()` flow:
1. If `autoDiscover` or `joiningServiceUrl` provided, use `JoiningClient`
2. Generate agent key (existing flow via `window.holochain.connect()`)
3. Call `join()` with agent key + any claims
4. If pending, invoke `onChallenge` callback for each challenge
5. Get credentials, configure linker URL, fetch and install hApp bundle with membrane proof
6. Fall back to existing direct `linkerUrl` flow if no joining service configured

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

## Phase 2: Extension Plumbing

### 2.1 Membrane proof in install flow

**Modified file**: `packages/extension/src/background/index.ts`

Update `handleInstallHapp` to accept and forward `membraneProof` from the `InstallAppRequest`.

**Modified file**: `packages/extension/src/lib/happ-context-manager.ts`

Update `installHapp()` to:
- Accept optional `membraneProof: Uint8Array`
- Store it in the `HappContext`
- Pass it through to genesis

### 2.2 Genesis membrane proof

**Modified file**: `packages/core/src/storage/genesis.ts`

Update `initializeGenesis()` to:
- Accept optional `membraneProof: Uint8Array`
- Include it in the `AgentValidationPkg` action (currently hardcoded to empty/null)

### 2.3 Context storage

**Modified file**: `packages/extension/src/lib/happ-context-storage.ts`

Add `membraneProof?: Uint8Array` to the stored `HappContext` schema. Handle serialization for IndexedDB.

### 2.4 Message passing

**Modified file**: `packages/extension/src/lib/messaging.ts` (or equivalent)

Ensure `membraneProof` (as `number[]`) survives Chrome message passing boundaries. Apply existing `normalizeUint8Arrays` / `serializeForTransport` patterns.

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
│   │   └── credentials.ts    # GET /v1/join/:session/credentials
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
│   └── invite-code.test.ts
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

The reference implementation uses Ed25519 signing:

```typescript
interface MembraneProofGenerator {
  generate(agentKey: string, metadata?: Record<string, unknown>): Promise<Uint8Array>;
}
```

Default implementation:
1. Create payload: `{ agent_key, timestamp, nonce }`
2. Sign with the service's Ed25519 key
3. Return msgpack-encoded `{ payload, signature, signer_pub_key }`

The DNA's `genesis_self_check` validates by checking the signature against the signer pub key stored in DNA properties.

---

## Phase Ordering and Dependencies

```
Phase 1.1-1.2 (types + JoiningClient)  ──► Phase 1.3 (WebConductorAppClient)
                                        ──► Phase 3 (Reference Server)

Phase 2.1-2.4 (Extension plumbing)     ──► Phase 1.3 (membrane proof threading)

Phase 3.1-3.4 (Reference Server)       ──► Integration testing
```

Phases 1.1-1.2 and 2.1-2.4 can proceed in parallel. Phase 1.3 depends on both. Phase 3 depends on 1.1 for types but can otherwise proceed independently.

---

## Verification Strategy

### Unit Tests
- `JoiningClient`: Mock HTTP responses, test all status transitions (ready, pending, rejected), challenge flows, error handling
- `JoinSession`: Test immutability, verify/poll/getCredentials methods
- `GatewayProxy`: Mock gateway responses
- Reference server routes: Test each endpoint with various auth methods

### Integration Tests
- Reference server + `JoiningClient`: End-to-end join flow
- Open auth: join → credentials in 2 calls
- Email auth: join → verify → credentials
- Invite code: join with valid/invalid code

### E2E Tests
- Full browser flow: extension + joining service + linker
- Test `.well-known` discovery
- Test membrane proof threading through install and genesis
- Test R/O gateway fallback before join

---

## Critical Files Reference

| File | Phase | Change |
|------|-------|--------|
| `packages/client/src/joining.ts` | 1.1 | New: JoiningClient, JoinSession |
| `packages/client/src/gateway-proxy.ts` | 1.4 | New: GatewayProxy |
| `packages/client/src/types.ts` | 1.2 | Add membraneProof to InstallAppRequest |
| `packages/client/src/WebConductorAppClient.ts` | 1.3 | Extend options, update connect() |
| `packages/client/src/index.ts` | 1.5 | Export new modules |
| `packages/extension/src/background/index.ts` | 2.1 | Forward membraneProof in install |
| `packages/extension/src/lib/happ-context-manager.ts` | 2.1 | Accept membraneProof |
| `packages/core/src/storage/genesis.ts` | 2.2 | Thread membraneProof into AgentValidationPkg |
| `packages/extension/src/lib/happ-context-storage.ts` | 2.3 | Store membraneProof |
