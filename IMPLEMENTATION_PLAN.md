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
│   ├── email/
│   │   ├── transport.ts      # EmailTransport interface
│   │   ├── postmark.ts       # Postmark API transport (production)
│   │   └── file.ts           # File transport (dev/testing)
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
  "email_dev": {
    "provider": "file",
    "output_dir": "./dev-emails"
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

### 3.3.1 Email transport plugin interface

The email-code auth method delegates actual delivery to a transport plugin:

```typescript
interface EmailTransport {
  send(to: string, subject: string, body: string): Promise<void>;
}
```

Two built-in implementations:

**`PostmarkTransport`** — Production. Sends via the Postmark API using the configured `api_key` and `from` address.

**`FileTransport`** — Development/testing. Writes each email to a timestamped file in `output_dir`:

```
dev-emails/
  2026-02-26T10-30-00Z_user@example.com.txt
```

File contents:
```
To: user@example.com
Subject: Your Mewsfeed verification code
Date: 2026-02-26T10:30:00Z

Your verification code is: 847291
```

The code can then be copied from the file and pasted into the UI during manual testing.

Transport selection is driven by `config.email.provider`:
- `"postmark"` → `PostmarkTransport` (requires `api_key`, `from`)
- `"file"` → `FileTransport` (requires `output_dir`, defaults to `./dev-emails`)

When running tests, the config uses `"provider": "file"` so no external services are needed.

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

## Phase 4: Bundling and Deployment

The joining service must be deployable alongside the hApp's web UI in two target configurations.

### 4.1 Cloudflare Worker + Pages

The joining service runs as a Cloudflare Worker; the hApp's web UI is deployed to Cloudflare Pages. Both share the same domain.

```
app.example.com/              → Cloudflare Pages (static UI assets)
app.example.com/v1/*           → Cloudflare Worker (joining service API)
app.example.com/.well-known/   → Pages or Worker (joining service discovery)
```

**Project structure additions:**

```
joining-service/
├── deploy/
│   ├── cloudflare/
│   │   ├── wrangler.toml          # Worker + Pages configuration
│   │   ├── worker-entry.ts        # Worker entrypoint (imports Hono app)
│   │   └── README.md              # Cloudflare deployment instructions
```

**Key design decisions:**
- Hono natively supports Cloudflare Workers — the same route handlers run without modification
- Session storage uses Cloudflare KV (implements the `SessionStore` interface from `session/store.ts`)
- Email transport config and signing keys stored in Worker secrets (`wrangler secret put`)
- The `.well-known/joining-service` route is served by the Worker
- Pages serves the static UI build output
- Routes are split via `wrangler.toml` route patterns: `/v1/*` and `/.well-known/*` go to the Worker, everything else to Pages

**New files:**
- `src/session/kv-store.ts` — `SessionStore` implementation backed by Cloudflare KV
- `deploy/cloudflare/worker-entry.ts` — thin wrapper that imports the Hono app and exports the Worker `fetch` handler

**Build:**
```bash
# Build the joining service worker
npm run build:worker    # bundles src/ into a single worker script

# Deploy
npx wrangler pages deploy ./ui-dist       # deploy UI
npx wrangler deploy                        # deploy worker
```

### 4.2 Edge-node Docker image

The joining service runs as a process alongside the Holochain conductor inside the existing edge-node Docker container (see `../edgenode`). The hApp's web UI is served by the same container via a lightweight static file server or reverse proxy.

```
edge-node container
├── holochain conductor        (existing, port 4444)
├── joining-service            (Node.js process, port 3000)
├── static file server / proxy (nginx or serve, port 8080)
│   ├── /                      → UI static assets
│   ├── /v1/*                  → proxy to joining-service:3000
│   └── /.well-known/*         → proxy to joining-service:3000
```

**Project structure additions:**

```
joining-service/
├── deploy/
│   ├── edgenode/
│   │   ├── Dockerfile             # Multi-stage: build joining service + bundle UI
│   │   ├── docker-compose.yml     # Compose with edgenode + joining service
│   │   ├── nginx.conf             # Reverse proxy config (UI + API routing)
│   │   ├── entrypoint.sh          # Starts joining service + nginx
│   │   └── README.md              # Edge-node deployment instructions
```

**Key design decisions:**
- Follows the edge-node pattern: Wolfi-base image, non-root user (UID 65532), tini for process supervision, persistent data under `/data`
- Session storage uses the in-memory store (single-node deployment; sufficient for edge-node scale)
- The joining service config file lives in `/data/joining-service/config.json`, persisted across container restarts
- The signing key is generated on first boot and stored in `/data/joining-service/signing-key.pem`
- nginx handles TLS termination (if needed) and routes `/v1/*` and `/.well-known/*` to the joining service, everything else to static UI files
- The hApp config JSON (same format as edge-node's `install_happ` tool) can reference the joining service URL so the hApp is installed with the correct joining service endpoint

**Docker build:**
```dockerfile
# Stage 1: Build joining service
FROM node:20-alpine AS builder
WORKDIR /app
COPY joining-service/ .
RUN npm ci && npm run build

# Stage 2: Runtime
FROM cgr.dev/chainguard/wolfi-base
COPY --from=builder /app/dist /opt/joining-service
COPY deploy/edgenode/nginx.conf /etc/nginx/
COPY deploy/edgenode/entrypoint.sh /usr/local/bin/
# ... nginx, node runtime, tini
EXPOSE 8080
ENTRYPOINT ["tini", "--", "entrypoint.sh"]
```

**Integration with edge-node:**
- Can be composed alongside the existing edge-node container via `docker-compose.yml`, or built as a single extended image that adds the joining service layer on top of the edge-node base
- The `happ_config_file` tool (from `../edgenode/tools/`) can be extended to include a `joiningService` section pointing to the co-located joining service

### 4.3 Shared build concerns

Both deployment targets share:
- The same Hono application code (no target-specific route logic)
- The same `AuthMethodPlugin` and `EmailTransport` interfaces
- The same config schema — only `session.store` and `email.provider` differ per target
- A single `npm run build` that produces a Node.js bundle; the Cloudflare worker entrypoint re-exports it for the Workers runtime

**Config differences by target:**

| Setting | Cloudflare | Edge-node |
|---------|-----------|-----------|
| `session.store` | `"cloudflare-kv"` | `"memory"` |
| `email.provider` | `"postmark"` | `"postmark"` or `"file"` |
| Secrets management | `wrangler secret` | Config file or env vars |
| TLS | Cloudflare edge | nginx or external LB |

---

## Phase Ordering and Dependencies

```
Phase 2 (Extension plumbing)           ──  COMPLETE

Phase 1.1 (JoiningClient)             ──► Phase 1.3 (WebConductorAppClient)
                                       ──► Phase 3 (Reference Server)

Phase 1.2 (dnaModifiers type)         ──► Phase 1.3

Phase 3.1-3.4 (Reference Server)      ──► Integration testing
                                       ──► Phase 4 (Deployment)

Phase 4.1 (Cloudflare)                ──  requires Phase 3 complete
Phase 4.2 (Edge-node Docker)           ──  requires Phase 3 complete
```

Phase 2 is done. Phase 1.1 and Phase 3 can proceed in parallel. Phase 1.3 depends on 1.1 completing. Phase 1.2 is a small type addition that can be done alongside 1.1. Phase 4 (both deployment targets) depends on Phase 3 completing, since it packages the built service. Phase 4.1 and 4.2 can proceed in parallel.

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
- Email auth: join → verify → credentials (see below)
- Invite code: join with valid/invalid code
- Reconnect: join → use credentials → reconnect with signature → receive updated URLs
- Reconnect after expiry: verify client gets fresh linker URLs with new `linker_urls_expire_at`

#### Email verification flow testing

All email tests use `"provider": "file"` so no Postmark credentials or network access are needed. The test flow:

1. Start the server with config `{ email: { provider: "file", output_dir: tmpDir } }`
2. `POST /v1/join` with `{ agent_key, claims: { email: "test@example.com" } }` → returns session with `status: "pending"` and a challenge of type `email_code`
3. Read the verification code from the file written to `tmpDir` (glob for `*test@example.com.txt`, parse the code from the body)
4. `POST /v1/join/:session/verify` with the extracted code → session transitions to `status: "ready"`
5. `GET /v1/join/:session/credentials` → returns membrane proofs and linker URLs

Additional email test cases:
- **Wrong code**: verify with an incorrect code → returns error, session stays `pending`
- **Expired code**: advance time past code TTL → verify returns error
- **Resend**: call join again with the same email → new code written to a new file, old code invalidated
- **Rate limiting**: rapid verify attempts → returns 429

For **manual QA / demo testing**, run the server with `"provider": "file"` and `output_dir` set to a convenient location. The tester opens the UI, enters their email, then checks the output directory for the file containing their code.

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
