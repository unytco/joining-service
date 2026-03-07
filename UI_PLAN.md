# Joining UI Web Components — Implementation Plan

Reusable, framework-agnostic web components for the joining service auth flow.
Published as sub-exports of `@holo-host/joining-service`.

## Architecture

Two layers:
- **Headless** (`@holo-host/joining-service/ui`) — Zero styling, ARIA attributes, event-driven API. For power users who bring their own design system.
- **Shoelace-styled** (`@holo-host/joining-service/ui/shoelace`) — Thin wrappers using Shoelace components. Drop-in with CSS custom property theming and `::part()` selectors.

Technology: Lit 3 web components. Shoelace as optional peer dependency for styled layer.

## Components

```
<joining-flow>                    -- Orchestrator (full flow manager)
  <joining-claims-form>           -- Collects initial claims (invite code, email, etc.)
  <joining-challenge-dialog>      -- Prompts for challenge responses
  <joining-status>                -- Shows session status
```

Each exists in headless (`<joining-*>`) and styled (`<joining-*-sl>`) variants.

## Auth Method -> UI Mapping

| Auth Method        | Claims Form        | Challenge Dialog        | Notes                          |
|--------------------|--------------------|-------------------------|--------------------------------|
| open               | None               | None                    | Automatic pass-through         |
| invite_code        | Text input         | Text input (if needed)  | Can satisfy via claims or challenge |
| email_code         | Email input        | 6-digit code input      | Two-step: collect email, verify code |
| agent_whitelist    | None               | None                    | Automatic (client signs nonce) |
| hc_auth_approval   | None               | Polling indicator       | "Pending approval..." + auto-poll |
| sms_code           | Phone input        | Code input              | Same pattern as email_code     |
| evm_signature      | Wallet connect slot | Sign message            | Requires wallet adapter        |
| solana_signature   | Wallet connect slot | Sign message            | Requires wallet adapter        |
| x-* (custom)       | Slot-based         | Generic text input      | Extensible via slots/events    |

For OR groups (`{ any_of: [...] }`), the UI shows a method selector (tabs in Shoelace, fieldset in headless).

## Dependency Graph

```
@holo-host/joining-service
  peerDependencies:
    lit: ^3.0.0                          (for ./ui)
    @shoelace-style/shoelace: ^2.11.0    (for ./ui/shoelace, optional)

@holo-host/web-conductor-client          (in hwc repo, already depends on joining-service)
  -- adapter function connectWithJoiningUI() lives here
  -- dependency direction: hwc-client -> joining-service (no circular dep)
```

---

## Stage 1: Foundation — Headless base components

Supports invite_code and email_code in UI; open and agent_whitelist automatically (no UI needed).

### 1.1 Project scaffolding
- [ ] Create `src/ui/` directory
- [ ] Add `lit` as peer dependency
- [ ] Add sub-exports to package.json: `./ui`, `./ui/shoelace`
- [ ] Configure tsconfig for UI source (may need composite projects or path config)
- [ ] Add build script that compiles UI alongside server/client

### 1.2 Headless `<joining-claims-form>`
- [ ] Accepts `authMethods: AuthMethodEntry[]` (from /v1/info)
- [ ] Renders inputs based on auth methods:
  - invite_code -> text input
  - email_code -> email input
  - Automatic methods (open, agent_whitelist) -> nothing
  - Unsupported/future methods -> named slot
- [ ] For `{ any_of: [...] }` groups, renders method selector (radio/fieldset)
- [ ] Emits `claims-submitted` event with `Record<string, string>`
- [ ] Emits `claims-cancelled` event
- [ ] Proper labels, ARIA attributes, form validation

### 1.3 Headless `<joining-challenge-dialog>`
- [ ] Accepts a `Challenge` object
- [ ] Renders based on challenge.type:
  - invite_code / email_code -> text input with label from challenge.description
  - Automatic types -> nothing (handled by orchestrator)
  - Unknown/custom -> generic text input + slot
- [ ] Emits `challenge-response` with `{ challengeId, response }`
- [ ] open/close API for dialog lifecycle
- [ ] ARIA dialog role, focus trapping

### 1.4 Headless `<joining-status>`
- [ ] Accepts status: connecting | collecting-claims | verifying | provisioning | ready | rejected | error
- [ ] Accepts reason?: string for rejected/error
- [ ] Renders status text in `<div role="status" aria-live="polite">`
- [ ] Emits `retry` event on error/rejected retry action

### 1.5 Headless `<joining-flow>` orchestrator
- [ ] Accepts: serviceUrl or joiningClient, plus agentKey
- [ ] Flow: fetch info -> show claims form -> join -> handle challenges -> provision
- [ ] Handles agent_whitelist automatically via signNonce callback
- [ ] Emits `join-complete` with JoinProvision
- [ ] Emits `join-error` with error details
- [ ] Accepts signNonce callback for agent_whitelist

### 1.6 Tests
- [ ] Unit tests per component (@open-wc/testing or vitest + happy-dom)
- [ ] Integration test: mock fetch, drive <joining-flow> through invite_code flow

---

## Stage 2: Shoelace styled layer

### 2.1 Setup
- [ ] Add @shoelace-style/shoelace as optional peer dependency
- [ ] Create `src/ui/shoelace/` directory

### 2.2 `<joining-claims-form-sl>`
- [ ] Uses sl-input, sl-button, sl-tab-group/sl-tab for OR groups
- [ ] CSS custom properties for colors, spacing, border-radius
- [ ] ::part() selectors for deep customization

### 2.3 `<joining-challenge-dialog-sl>`
- [ ] Uses sl-dialog, sl-input, sl-button, sl-spinner
- [ ] Same theming approach

### 2.4 `<joining-status-sl>`
- [ ] Uses sl-alert, sl-spinner, sl-icon, sl-button (retry)

### 2.5 `<joining-flow-sl>` orchestrator
- [ ] Composes Shoelace sub-components
- [ ] Same API as headless, renders styled
- [ ] theme attribute: light | dark

### 2.6 Tests + publish
- [ ] Event parity tests with headless
- [ ] Verify sub-exports resolve correctly when published
- [ ] Verify tree-shaking: server-only consumers don't pull in Lit
- [ ] Update package version, publish

---

## Stage 3: hwc-client integration adapter

Lives in the hwc-client repo (not here). Dependency direction: hwc-client -> joining-service.

### 3.1 `connectWithJoiningUI()` function
- [ ] New export in @holo-host/web-conductor-client
- [ ] Creates <joining-flow-sl>, appends to mount point or document.body
- [ ] Wires signNonce to holochain.signJoiningNonce()
- [ ] On join-complete, calls WebConductorAppClient.connect() with provision
- [ ] Removes UI when done, returns connected client

### 3.2 Documentation
- [ ] Usage examples: explicit <joining-flow> placement and one-liner
- [ ] Snippets for Vue, React, Svelte, vanilla HTML

---

## Stage 4: Migration

### 4.1 Migrate mewsfeed-hwc
- [ ] Replace JoiningClaimsDialog.vue and JoiningChallengeDialog.vue with <joining-flow-sl>
- [ ] Remove Headless UI dependency if no longer needed
- [ ] End-to-end verification

---

## Stage 5: Remaining auth methods

Incremental additions after initial publish.

### 5.1 hc_auth_approval
- [ ] Polling indicator UI in challenge dialog
- [ ] "Pending approval..." with spinner, auto-polls at poll_interval_ms

### 5.2 sms_code
- [ ] Phone input in claims form
- [ ] Code input in challenge dialog (same pattern as email_code)

### 5.3 evm_signature
- [ ] Slot-based wallet connect in claims form
- [ ] Optional sub-export `./ui/evm` with default ethers/viem implementation
- [ ] Challenge: sign message with nonce

### 5.4 solana_signature
- [ ] Same pattern as EVM, optional sub-export `./ui/solana`

### 5.5 x-* custom methods
- [ ] Generic text input + named slots
- [ ] Event interception for programmatic handling

### 5.6 OR group tab UI
- [ ] Headless: radio/fieldset selection
- [ ] Shoelace: sl-tab-group with one tab per method
