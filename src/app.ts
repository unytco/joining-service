import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { ServiceConfig } from './config.js';
import type { AuthMethodPlugin } from './auth-methods/plugin.js';
import type { SessionStore, ChallengeState } from './session/store.js';
import type { MembraneProofGenerator } from './membrane-proof/generator.js';
import type { UrlProvider } from './urls/provider.js';
import type { Challenge } from './types.js';
import {
  generateSessionId,
  validateAgentKey,
  toBase64,
  fromBase64,
  agentKeyToRawEd25519Base64url,
} from './utils.js';
import type { HcAuthClient } from './hc-auth/index.js';
import * as ed from '@noble/ed25519';

export interface ServiceContext {
  config: ServiceConfig;
  sessionStore: SessionStore;
  authPlugins: Map<string, AuthMethodPlugin>;
  proofGenerator?: MembraneProofGenerator;
  urlProvider: UrlProvider;
  hcAuthClient?: HcAuthClient;
}

async function notifyHcAuth(
  ctx: ServiceContext,
  agentKey: string,
): Promise<void> {
  if (!ctx.hcAuthClient) return;
  const rawKey = agentKeyToRawEd25519Base64url(agentKey);
  const metadata = { agent_key: agentKey, happ_id: ctx.config.happ.id };
  try {
    await ctx.hcAuthClient.registerAndAuthorize(rawKey, metadata);
  } catch (err) {
    if (ctx.config.hc_auth?.required) throw err;
    console.error('[hc-auth] registerAndAuthorize failed (non-fatal):', err);
  }
}

function errorJson(code: string, message: string, status: number) {
  return new Response(
    JSON.stringify({ error: { code, message } }),
    {
      status,
      headers: { 'Content-Type': 'application/json' },
    },
  );
}

export function createApp(ctx: ServiceContext): Hono {
  const app = new Hono();

  app.use('*', cors());

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Joining-Service-Version', '1.0');
  });

  // ---- GET /.well-known/holo-joining ----
  app.get('/.well-known/holo-joining', (c) => {
    const { config } = ctx;
    const baseUrl = config.base_url ?? c.req.url.replace(/\/.well-known\/holo-joining$/, '');
    return c.json({
      joining_service_url: `${baseUrl}/v1`,
      happ_id: config.happ.id,
      version: '1.0',
    });
  });

  // ---- GET /v1/info ----
  app.get('/v1/info', async (c) => {
    const { config } = ctx;
    const linkerUrls = await ctx.urlProvider.getLinkerUrls();
    const httpGateways = await ctx.urlProvider.getHttpGateways();
    return c.json({
      happ: {
        id: config.happ.id,
        name: config.happ.name,
        description: config.happ.description,
        icon_url: config.happ.icon_url,
      },
      http_gateways: httpGateways,
      auth_methods: config.auth_methods,
      linker_info: linkerUrls
        ? (config.linker_info ?? { selection_mode: 'assigned' })
        : undefined,
      happ_bundle_url: config.happ.happ_bundle_url,
      dna_modifiers: config.dna_modifiers,
    });
  });

  // ---- POST /v1/join ----
  app.post('/v1/join', async (c) => {
    const body = await c.req.json();
    const { agent_key, claims = {} } = body;

    if (!agent_key) {
      return errorJson('invalid_agent_key', 'agent_key is required', 400);
    }

    const validation = validateAgentKey(agent_key);
    if (!validation.valid) {
      return errorJson('invalid_agent_key', validation.reason!, 400);
    }

    // Check if agent already joined
    const existing = await ctx.sessionStore.findByAgentKey(agent_key);
    if (existing?.status === 'ready') {
      return errorJson(
        'agent_already_joined',
        'This agent key has already completed joining. Use POST /v1/reconnect instead.',
        409,
      );
    }

    // Delete any stale pending session for this agent
    if (existing) {
      await ctx.sessionStore.delete(existing.id);
    }

    const sessionId = generateSessionId();
    const allChallenges: ChallengeState[] = [];

    // Create challenges from each auth method
    for (const method of ctx.config.auth_methods) {
      const plugin = ctx.authPlugins.get(method);
      if (!plugin) continue;

      try {
        const challenges = await plugin.createChallenges(
          agent_key,
          claims,
          ctx.config,
        );
        for (const ch of challenges) {
          allChallenges.push({
            challenge: ch,
            expected_response: (ch.metadata?.expected_code as string) ?? '',
            completed: false,
            attempts: 0,
            expires_at: ch.expires_at
              ? new Date(ch.expires_at).getTime()
              : Date.now() + 600_000,
          });
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : 'Unknown error';
        return errorJson('missing_claims', message, 400);
      }
    }

    const status = allChallenges.length === 0 ? 'ready' : 'pending';

    // For invite_code, auto-verify at join time
    if (status === 'pending') {
      for (const cs of allChallenges) {
        if (cs.challenge.type === 'invite_code') {
          const plugin = ctx.authPlugins.get('invite_code');
          if (plugin) {
            const result = await plugin.verifyChallengeResponse(
              cs.challenge,
              claims.invite_code ?? '',
              claims,
            );
            if (!result.passed) {
              return c.json(
                {
                  session: sessionId,
                  status: 'rejected' as const,
                  reason: result.reason ?? 'Invalid invite code',
                },
                201,
              );
            }
            cs.completed = true;
          }
        }
      }
    }

    const allCompleted = allChallenges.every((cs) => cs.completed);
    const finalStatus = allCompleted ? 'ready' : status;

    if (finalStatus === 'ready') {
      await notifyHcAuth(ctx, agent_key);
    }

    await ctx.sessionStore.create({
      id: sessionId,
      agent_key,
      status: finalStatus,
      challenges: allChallenges,
      claims,
      created_at: Date.now(),
    });

    const response: Record<string, unknown> = {
      session: sessionId,
      status: finalStatus,
    };

    if (finalStatus === 'pending') {
      response.challenges = allChallenges
        .filter((cs) => !cs.completed)
        .map((cs) => stripInternal(cs.challenge));
      response.poll_interval_ms = 2000;
    }

    return c.json(response, 201);
  });

  // ---- POST /v1/join/:session/verify ----
  app.post('/v1/join/:session/verify', async (c) => {
    const sessionId = c.req.param('session');
    const session = await ctx.sessionStore.get(sessionId);

    if (!session) {
      return errorJson('invalid_session', 'Session not found or expired', 401);
    }

    if (session.status !== 'pending') {
      return errorJson(
        'invalid_session',
        `Session is ${session.status}, not pending`,
        401,
      );
    }

    const body = await c.req.json();
    const { challenge_id, response: challengeResponse } = body;

    const challengeState = session.challenges.find(
      (cs) => cs.challenge.id === challenge_id,
    );

    if (!challengeState) {
      return errorJson(
        'challenge_not_found',
        'Challenge not found for this session',
        404,
      );
    }

    if (challengeState.completed) {
      return errorJson(
        'challenge_not_found',
        'Challenge already completed',
        404,
      );
    }

    if (Date.now() > challengeState.expires_at) {
      return errorJson(
        'challenge_expired',
        'Challenge has expired; start a new join',
        410,
      );
    }

    challengeState.attempts++;
    if (challengeState.attempts > 5) {
      return errorJson(
        'rate_limited',
        'Too many verification attempts',
        429,
      );
    }

    const plugin = ctx.authPlugins.get(challengeState.challenge.type);
    if (!plugin) {
      return errorJson('invalid_response', 'Unknown auth method', 400);
    }

    const result = await plugin.verifyChallengeResponse(
      challengeState.challenge,
      challengeResponse,
      session.claims,
    );

    if (!result.passed) {
      await ctx.sessionStore.update(sessionId, {
        challenges: session.challenges,
      });
      return errorJson(
        'verification_failed',
        result.reason ?? 'Verification failed',
        422,
      );
    }

    challengeState.completed = true;

    const allCompleted = session.challenges.every((cs) => cs.completed);
    const newStatus = allCompleted ? 'ready' : 'pending';

    await ctx.sessionStore.update(sessionId, {
      status: newStatus,
      challenges: session.challenges,
    });

    if (newStatus === 'ready') {
      await notifyHcAuth(ctx, session.agent_key);
    }

    const resp: Record<string, unknown> = { status: newStatus };
    if (newStatus === 'pending') {
      resp.challenges_remaining = session.challenges
        .filter((cs) => !cs.completed)
        .map((cs) => stripInternal(cs.challenge));
      resp.poll_interval_ms = 2000;
    }

    return c.json(resp);
  });

  // ---- GET /v1/join/:session/status ----
  app.get('/v1/join/:session/status', async (c) => {
    const sessionId = c.req.param('session');
    const session = await ctx.sessionStore.get(sessionId);

    if (!session) {
      return errorJson('invalid_session', 'Session not found or expired', 401);
    }

    const resp: Record<string, unknown> = { status: session.status };

    if (session.status === 'pending') {
      resp.challenges = session.challenges.map((cs) => ({
        ...stripInternal(cs.challenge),
        completed: cs.completed,
      }));
      resp.poll_interval_ms = 2000;
    }

    if (session.status === 'rejected' && session.reason) {
      resp.reason = session.reason;
    }

    return c.json(resp);
  });

  // ---- GET /v1/join/:session/provision ----
  app.get('/v1/join/:session/provision', async (c) => {
    const sessionId = c.req.param('session');
    const session = await ctx.sessionStore.get(sessionId);

    if (!session) {
      return errorJson('invalid_session', 'Session not found or expired', 401);
    }

    if (session.status !== 'ready') {
      return errorJson(
        'not_ready',
        `Session status is "${session.status}", not "ready"`,
        403,
      );
    }

    const linkerUrls = await ctx.urlProvider.getLinkerUrls();

    let membraneProofs: Record<string, string> | undefined;
    if (ctx.proofGenerator && ctx.config.dna_hashes?.length) {
      const rawProofs = await ctx.proofGenerator.generate(
        session.agent_key,
        ctx.config.dna_hashes,
      );
      membraneProofs = {};
      for (const [hash, proof] of Object.entries(rawProofs)) {
        membraneProofs[hash] = toBase64(proof);
      }
    }

    return c.json({
      linker_urls: linkerUrls,
      membrane_proofs: membraneProofs,
      happ_bundle_url: ctx.config.happ.happ_bundle_url,
      dna_modifiers: ctx.config.dna_modifiers,
    });
  });

  // ---- POST /v1/reconnect ----
  app.post('/v1/reconnect', async (c) => {
    if (!ctx.config.reconnect?.enabled) {
      return errorJson('not_found', 'Reconnect is not enabled', 404);
    }

    const body = await c.req.json();
    const { agent_key, timestamp, signature } = body;

    if (!agent_key) {
      return errorJson('invalid_agent_key', 'agent_key is required', 400);
    }

    const validation = validateAgentKey(agent_key);
    if (!validation.valid) {
      return errorJson('invalid_agent_key', validation.reason!, 400);
    }

    if (!timestamp || !signature) {
      return errorJson(
        'invalid_signature',
        'timestamp and signature are required',
        400,
      );
    }

    // Validate timestamp is within tolerance
    const toleranceSeconds =
      ctx.config.reconnect.timestamp_tolerance_seconds ?? 300;
    const tsDate = new Date(timestamp);
    if (isNaN(tsDate.getTime())) {
      return errorJson(
        'timestamp_out_of_range',
        'Invalid timestamp format',
        400,
      );
    }

    const drift = Math.abs(Date.now() - tsDate.getTime());
    if (drift > toleranceSeconds * 1000) {
      return errorJson(
        'timestamp_out_of_range',
        `Timestamp is ${Math.round(drift / 1000)}s from server time (max ${toleranceSeconds}s)`,
        400,
      );
    }

    // Verify agent has joined
    const session = await ctx.sessionStore.findByAgentKey(agent_key);
    if (!session || session.status !== 'ready') {
      return errorJson(
        'agent_not_joined',
        'This agent key has not completed joining',
        403,
      );
    }

    // Verify ed25519 signature of the timestamp string
    const sigBytes = fromBase64(signature);
    const msgBytes = new TextEncoder().encode(timestamp);
    // Extract the raw 32-byte ed25519 public key from the 39-byte AgentPubKey
    // (skip 3-byte HoloHash prefix, take 32 bytes, skip 4-byte DHT location)
    const agentKeyBytes = fromBase64(agent_key);
    const publicKey = agentKeyBytes.slice(3, 35);

    let valid: boolean;
    try {
      valid = await ed.verifyAsync(sigBytes, msgBytes, publicKey);
    } catch {
      valid = false;
    }

    if (!valid) {
      return errorJson(
        'invalid_signature',
        'Signature does not verify against agent key',
        400,
      );
    }

    const [linkerUrls, httpGateways] = await Promise.all([
      ctx.urlProvider.getLinkerUrls(),
      ctx.urlProvider.getHttpGateways(),
    ]);

    return c.json({
      linker_urls: linkerUrls,
      http_gateways: httpGateways,
    });
  });

  return app;
}

function stripInternal(challenge: Challenge): Challenge {
  const { metadata, ...rest } = challenge;
  // Strip expected_code from metadata before sending to client
  if (metadata) {
    const { expected_code: _, ...safeMetadata } = metadata as Record<
      string,
      unknown
    >;
    if (Object.keys(safeMetadata).length > 0) {
      return { ...rest, metadata: safeMetadata };
    }
  }
  return rest;
}
