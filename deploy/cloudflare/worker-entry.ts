/**
 * Cloudflare Worker entry point for the joining service.
 *
 * Imports the Hono app and wires it up with Cloudflare-specific bindings
 * (KV for sessions, secrets for config).
 */

import { createApp, type ServiceContext } from '../../src/app.js';
import { resolveConfig, type ServiceConfig } from '../../src/config.js';
import { KvSessionStore } from '../../src/session/kv-store.js';
import { OpenAuthMethod } from '../../src/auth-methods/open.js';
import { EmailCodeAuthMethod } from '../../src/auth-methods/email-code.js';
import { InviteCodeAuthMethod } from '../../src/auth-methods/invite-code.js';
import { PostmarkTransport } from '../../src/email/postmark.js';
import { Ed25519ProofGenerator } from '../../src/membrane-proof/ed25519-signer.js';
import type { AuthMethodPlugin } from '../../src/auth-methods/plugin.js';
import type { EmailTransport } from '../../src/email/transport.js';

interface Env {
  SESSIONS: KVNamespace;
  CONFIG_JSON: string;
  SIGNING_KEY_HEX?: string;
}

function buildEmailTransport(config: ServiceConfig): EmailTransport | null {
  if (!config.email) return null;

  // Only postmark is supported on Workers (no filesystem for FileTransport)
  if (config.email.provider === 'postmark') {
    if (!config.email.api_key || !config.email.from) {
      throw new Error('Postmark requires api_key and from');
    }
    return new PostmarkTransport(config.email.api_key, config.email.from);
  }

  return null;
}

function buildAuthPlugins(
  config: ServiceConfig,
  emailTransport: EmailTransport | null,
): Map<string, AuthMethodPlugin> {
  const plugins = new Map<string, AuthMethodPlugin>();

  for (const method of config.auth_methods) {
    switch (method) {
      case 'open':
        plugins.set('open', new OpenAuthMethod());
        break;

      case 'email_code':
        if (!emailTransport) {
          throw new Error(
            'email_code auth requires email config with postmark provider',
          );
        }
        plugins.set(
          'email_code',
          new EmailCodeAuthMethod({
            transport: emailTransport,
            subject: config.email?.template
              ? undefined
              : 'Your verification code',
            template: config.email?.template,
          }),
        );
        break;

      case 'invite_code':
        plugins.set(
          'invite_code',
          new InviteCodeAuthMethod(config.invite_codes ?? []),
        );
        break;

      default:
        console.warn(`Unknown auth method: ${method}, skipping`);
    }
  }

  return plugins;
}

async function buildProofGenerator(
  signingKeyHex?: string,
): Promise<Ed25519ProofGenerator | undefined> {
  if (!signingKeyHex) return undefined;

  const privateKey = new Uint8Array(
    signingKeyHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)),
  );
  return new Ed25519ProofGenerator(privateKey);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const configInput = JSON.parse(env.CONFIG_JSON) as Partial<ServiceConfig>;

    // Override session store to cloudflare-kv (ignored by resolveConfig,
    // we construct the store directly)
    const config = resolveConfig(configInput);

    const sessionStore = new KvSessionStore(
      env.SESSIONS,
      config.session?.pending_ttl_seconds ?? 3600,
      config.session?.ready_ttl_seconds ?? 86400,
    );

    const emailTransport = buildEmailTransport(config);
    const authPlugins = buildAuthPlugins(config, emailTransport);

    let proofGenerator: Ed25519ProofGenerator | undefined;
    if (config.membrane_proof?.enabled) {
      proofGenerator = await buildProofGenerator(env.SIGNING_KEY_HEX);
    }

    const context: ServiceContext = {
      config,
      sessionStore,
      authPlugins,
      proofGenerator,
    };

    const app = createApp(context);
    return app.fetch(request);
  },
};
