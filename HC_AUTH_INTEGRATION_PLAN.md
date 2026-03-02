# HC-Auth-Server Integration Plan

## Overview

Add a module to the joining service that registers and authorizes agents on the
[hc-auth-server](https://github.com/holochain/hc-auth-server) after they have
passed all joining challenges. This lets the hc-auth-server act as an
authorization gate for Holochain bootstrap/discovery services (e.g.
kitsune2-bootstrap-srv), with the joining service as the trust source.

---

## hc-auth-server API Surface (Summary)

### Client Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/now` | Returns `{ timestamp, nonce }` (base64url) for challenge signing |
| PUT | `/request-auth/{pubkey}` | Registers a public key as a pending auth request |
| PUT | `/authenticate` | Submits signed challenge; returns token if authorized |

### Admin Endpoints (Bearer token required)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/list` | List all requests with states |
| GET | `/api/get/{key}` | Get full record for a key |
| POST | `/api/transition` | Transition key between `pending → authorized → blocked` |

### States

```
Pending ──→ Authorized ──→ Blocked
              ↑                ↓
              └────────────────┘
```

### Key format used by hc-auth-server

Plain 32-byte Ed25519 public key, base64url-encoded (no HoloHash wrapping).
Holochain agent keys are 39-byte HoloHash: `[0x84, 0x20, 0x24] + <32 bytes key> + <4 bytes DHT location>`.
**Extraction**: bytes 3–34 (inclusive) of the decoded agent key.

---

## Integration Architecture

### Where the Authorization Happens

The joining service should authorize agents in hc-auth-server at the point
where the agent earns "ready" status — i.e., after all challenges have been
verified. The natural hook is in `app.ts` inside the
`GET /v1/join/{session}/credentials` handler, immediately before returning
credentials. This keeps the hc-auth-server interaction as a side-effect of
credential issuance, not part of challenge verification.

**Alternatively** (and more robust): authorize at the moment the last challenge
passes (inside `POST /v1/join/{session}/verify`), so it happens atomically with
the status transition. This is the preferred approach because:
- It avoids double-authorization if credentials are fetched multiple times.
- Authorization can be retried on transient failure without issuing partial credentials.

### Authorization call sequence (joining service → hc-auth-server)

```
1. Agent passes all challenges → status transitions to "ready"
2. Joining service extracts 32-byte ed25519 key from HoloHash
3. PUT /request-auth/{raw_pubkey_base64url}  (body: { agent_key, happ_id, joined_at })
   → 202 (pending) or 429 (already pending — continue to step 4)
4. POST /api/transition  { pub_key, old_state: "pending", new_state: "authorized" }
   → 200 OK
5. Continue — agent can now authenticate with hc-auth-server independently
```

If step 3 returns 4xx (not 429), log the error but do NOT block credential
issuance — hc-auth registration failure should be non-fatal so the joining flow
is not broken by a transient hc-auth outage. The operator can re-authorize
manually via the hc-auth-server admin UI.

---

## Module Design

### New files

```
src/hc-auth/
├── client.ts       # HcAuthClient — thin HTTP client wrapping the admin API
├── plugin.ts       # HcAuthPlugin — called after session reaches "ready"
└── index.ts        # Re-exports HcAuthClient, HcAuthPlugin, HcAuthConfig
```

### `HcAuthConfig`

```typescript
interface HcAuthConfig {
  /** Base URL of the hc-auth-server, e.g. "https://auth.holo.host" */
  url: string;
  /** Bearer token from the server's API_TOKENS config */
  api_token: string;
  /**
   * Whether a failure to register/authorize should block credential issuance.
   * Default: false (non-fatal).
   */
  required?: boolean;
}
```

Add optional `hc_auth?: HcAuthConfig` field to `ServiceConfig` in `src/config.ts`.

### `HcAuthClient` (`src/hc-auth/client.ts`)

```typescript
type AgentState = "pending" | "authorized" | "blocked";

interface HcAuthRecord {
  state: AgentState;
  pubKey: string;  // base64url 32-byte key
  json?: unknown;  // metadata stored at registration time
}

class HcAuthClient {
  constructor(private config: HcAuthConfig) {}

  /** Register a key as pending. Returns true if newly registered, false if already exists. */
  async requestAuth(rawPubKeyB64url: string, metadata: unknown): Promise<void>;

  /** Transition key state using the admin API. */
  async transition(
    rawPubKeyB64url: string,
    oldState: AgentState,
    newState: AgentState,
  ): Promise<void>;

  /** Get the current record for a key. Returns null if not found. */
  async getRecord(rawPubKeyB64url: string): Promise<HcAuthRecord | null>;

  /**
   * High-level helper: register + immediately authorize.
   * Idempotent — if already authorized, no-ops.
   * If already pending (e.g. prior partial run), skips requestAuth and goes straight to transition.
   */
  async registerAndAuthorize(rawPubKeyB64url: string, metadata: unknown): Promise<void>;
}
```

### Key extraction helper (`src/utils.ts` — add alongside existing helpers)

```typescript
/**
 * Extract the 32-byte Ed25519 public key from a Holochain AgentPubKey (39-byte HoloHash).
 * The HoloHash layout is: [3 bytes prefix] [32 bytes key] [4 bytes DHT location].
 * Returns base64url-encoded string suitable for hc-auth-server.
 */
export function agentKeyToRawEd25519Base64url(agentKey: string): string;
```

### Integration point in `app.ts`

In `POST /v1/join/{session}/verify`, after all challenges pass and session
status is set to "ready":

```typescript
// If hc-auth is configured, register and authorize the agent
if (ctx.hcAuthClient) {
  const rawKey = agentKeyToRawEd25519Base64url(session.agent_key);
  const meta = { agent_key: session.agent_key, happ_id: ctx.config.happ.id };
  try {
    await ctx.hcAuthClient.registerAndAuthorize(rawKey, meta);
  } catch (err) {
    if (ctx.config.hc_auth?.required) throw err;
    console.error('[hc-auth] registration failed (non-fatal):', err);
  }
}
```

`HcAuthClient` is added to `ServiceContext` as an optional field:
```typescript
interface ServiceContext {
  // existing fields ...
  hcAuthClient?: HcAuthClient;
}
```

In `server.ts`, construct client if config present:
```typescript
const hcAuthClient = config.hc_auth
  ? new HcAuthClient(config.hc_auth)
  : undefined;
```

---

## Config Example

```json
{
  "happ": { "id": "uhCkk...", "name": "My App" },
  "auth_methods": ["email_code"],
  "linker_urls": ["wss://linker.holo.host:8090"],
  "hc_auth": {
    "url": "https://auth.holo.host",
    "api_token": "SECRET_TOKEN",
    "required": false
  }
}
```

---

## Idempotency and Edge Cases

| Scenario | Handling |
|----------|---------|
| Agent already `authorized` in hc-auth-server | `getRecord` returns authorized → no-op |
| Agent already `pending` (prior partial run) | Skip `requestAuth`, go straight to `transition` |
| Agent `blocked` | Log warning, transition `blocked → authorized` if `required=true`; otherwise non-fatal |
| hc-auth-server unreachable | Non-fatal by default; log error; credential issuance proceeds |
| Credentials fetched multiple times (idempotent GET) | Authorization already done at verify time; no double-call |
| `PUT /request-auth` returns 429 (too many pending) | Treat as "already pending" → proceed to transition |

---

## Data Flow Diagram

```
Browser Extension
      │
      │  POST /v1/join
      ▼
Joining Service
      │  createChallenges() → email_code, invite_code, etc.
      │  returns { status: "pending", challenges }
      │
      │  POST /v1/join/{session}/verify  (challenge response)
      ▼
Joining Service  ─────────────────────────────────────────────►  hc-auth-server
      │          PUT /request-auth/{raw_ed25519_key_b64url}          │
      │          POST /api/transition (pending → authorized)         │
      │◄─────────────────────────────────────────────────────────────┘
      │  session.status = "ready"
      │
      │  GET /v1/join/{session}/credentials
      ▼
Browser Extension receives membrane_proofs + linker_urls

      (Later, agent authenticates directly to hc-auth-server)
Browser Extension ──────────────────────────────────────────►  hc-auth-server
                  GET /now → sign with agent key
                  PUT /authenticate
                  ◄── token (for kitsune2-bootstrap-srv)
```

---

## Tests to Write

All tests in `test/hc-auth/`:

1. **`client.test.ts`** — Unit tests for `HcAuthClient` with mocked `fetch`:
   - `requestAuth` happy path (202)
   - `requestAuth` already-pending (429) treated as success
   - `transition` happy path (200)
   - `transition` 404 throws
   - `getRecord` returns null on 404
   - `registerAndAuthorize` idempotency: already-authorized → no-op
   - `registerAndAuthorize` partial: pending → authorized

2. **`plugin.test.ts`** — Integration tests using `createTestApp()`:
   - hc-auth enabled + successful registration → status "ready" + auth called
   - hc-auth enabled + server error (required=false) → status "ready", error logged
   - hc-auth enabled + server error (required=true) → 500
   - hc-auth disabled → no auth calls, normal flow

3. **`utils.test.ts`** — `agentKeyToRawEd25519Base64url`:
   - Correct extraction from known test agent key
   - Throws on invalid length

---

## Implementation Order

1. `src/utils.ts` — add `agentKeyToRawEd25519Base64url`, with tests
2. `src/hc-auth/client.ts` — `HcAuthClient` class, with unit tests
3. `src/config.ts` — add `HcAuthConfig` and `hc_auth?` field to `ServiceConfig`
4. `src/hc-auth/index.ts` — re-exports
5. `src/server.ts` — construct `HcAuthClient` from config; add to `ServiceContext`
6. `src/types.ts` / `src/app.ts` — add `hcAuthClient?` to `ServiceContext`; call `registerAndAuthorize` on verify
7. Integration tests
8. `README.md` / config docs update

---

## Open Questions

1. **Should the joining service also need to perform the credential-less flow for
   kitsune2-bootstrap** (i.e., is the hc-auth token piped back to the client)?
   Currently the plan stops at "authorize agent in hc-auth-server". If the
   joining service also needs to proxy the full challenge-response token back to
   the client for use with bootstrap, that is a larger scope change (new
   credential field + client flow).

2. **Should `blocked` keys be re-authorized?** Current plan: log a warning and
   attempt `blocked → authorized` only if `required=true`. This could be
   surprising. Alternatively, treat `blocked` as a hard rejection (return error
   regardless of `required`).

3. **Request metadata schema**: hc-auth-server stores whatever JSON is in the
   request body of `PUT /request-auth`. The plan above sends
   `{ agent_key, happ_id }`. Confirm what metadata the ops team wants visible
   in the hc-auth-server admin UI.
