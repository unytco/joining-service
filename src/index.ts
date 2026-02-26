// Public API exports
export { createApp, type ServiceContext } from './app.js';
export { resolveConfig, type ServiceConfig } from './config.js';
export { startServer } from './server.js';

// Session
export type { SessionStore, SessionData, ChallengeState } from './session/store.js';
export { MemorySessionStore } from './session/memory-store.js';
export { SqliteSessionStore } from './session/sqlite-store.js';

// Auth plugins
export type { AuthMethodPlugin } from './auth-methods/plugin.js';
export { OpenAuthMethod } from './auth-methods/open.js';
export { EmailCodeAuthMethod } from './auth-methods/email-code.js';
export { InviteCodeAuthMethod } from './auth-methods/invite-code.js';

// Email transports
export type { EmailTransport } from './email/transport.js';
export { FileTransport } from './email/file.js';
export { PostmarkTransport } from './email/postmark.js';

// Membrane proof
export type { MembraneProofGenerator } from './membrane-proof/generator.js';
export { Ed25519ProofGenerator } from './membrane-proof/ed25519-signer.js';

// Types
export * from './types.js';

// Utilities
export { validateAgentKey, generateSessionId, toBase64, fromBase64 } from './utils.js';
