import { createHash } from 'node:crypto';
import type { Challenge } from '../types.js';
import type { AuthMethodPlugin } from './plugin.js';

export interface TrustedPartner {
  partner_id: string;
  name: string;
  api_key_hash: string;
  allowed_claims: string[];
  rate_limit: number;
  rate_limit_window_minutes: number;
}

export interface DelegatedVerificationConfig {
  trusted_partners: TrustedPartner[];
  max_verification_age_hours?: number;
}

export interface DelegatedVerificationPayload {
  partner_id: string;
  verified_at: string;
  verification_method: string;
  reference_id?: string;
  attested_claims: Record<string, string>;
}

interface RateWindow {
  count: number;
  window_start: number;
}

/**
 * Delegated verification auth method.
 *
 * This plugin itself returns no challenges (like `open`). The actual
 * validation (API key, partner, freshness, rate limits) happens in the
 * join handler middleware *before* the plugin flow runs — see
 * `validateDelegatedVerification()`.
 *
 * The plugin is registered so the auth_methods config accepts the name
 * and the standard plugin resolution works.
 */
export class DelegatedVerificationAuthMethod implements AuthMethodPlugin {
  type = 'delegated_verification';

  async createChallenges(): Promise<Challenge[]> {
    // No challenges — delegated verification is pre-validated
    return [];
  }

  async verifyChallengeResponse(): Promise<{ passed: boolean }> {
    // Never called — no challenges issued
    return { passed: false };
  }
}

/** Rate limit state per partner (in-memory, resets on restart). */
const rateLimitState = new Map<string, RateWindow>();

function hashApiKey(apiKey: string): string {
  return 'sha256:' + createHash('sha256').update(apiKey).digest('hex');
}

export interface DelegatedValidationResult {
  valid: true;
  partner: TrustedPartner;
  payload: DelegatedVerificationPayload;
}

export interface DelegatedValidationError {
  valid: false;
  status: number;
  code: string;
  message: string;
}

/**
 * Validate the shape of a delegated_verification payload at runtime.
 * Returns null if valid, or an error result if malformed.
 */
export function validatePayloadShape(
  payload: unknown,
): DelegatedValidationError | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    return {
      valid: false,
      status: 400,
      code: 'invalid_payload',
      message: 'delegated_verification must be an object',
    };
  }

  const p = payload as Record<string, unknown>;

  if (typeof p.partner_id !== 'string' || !p.partner_id) {
    return {
      valid: false,
      status: 400,
      code: 'invalid_payload',
      message: 'delegated_verification.partner_id must be a non-empty string',
    };
  }

  if (typeof p.verified_at !== 'string' || !p.verified_at) {
    return {
      valid: false,
      status: 400,
      code: 'invalid_payload',
      message: 'delegated_verification.verified_at must be a non-empty string',
    };
  }

  if (typeof p.verification_method !== 'string' || !p.verification_method) {
    return {
      valid: false,
      status: 400,
      code: 'invalid_payload',
      message: 'delegated_verification.verification_method must be a non-empty string',
    };
  }

  if (typeof p.attested_claims !== 'object' || p.attested_claims === null || Array.isArray(p.attested_claims)) {
    return {
      valid: false,
      status: 400,
      code: 'invalid_payload',
      message: 'delegated_verification.attested_claims must be an object',
    };
  }

  return null;
}

/**
 * Validate delegated verification config on startup.
 * Throws on invalid configuration.
 */
export function validateDelegatedVerificationConfig(config: DelegatedVerificationConfig): void {
  const partnerIds = new Set<string>();

  for (const partner of config.trusted_partners) {
    if (partnerIds.has(partner.partner_id)) {
      throw new Error(`Duplicate partner_id in delegated_verification config: "${partner.partner_id}"`);
    }
    partnerIds.add(partner.partner_id);

    if (!partner.api_key_hash.startsWith('sha256:')) {
      throw new Error(
        `Invalid api_key_hash for partner "${partner.partner_id}": must start with "sha256:"`,
      );
    }

    if (typeof partner.rate_limit !== 'number' || partner.rate_limit <= 0) {
      throw new Error(
        `Invalid rate_limit for partner "${partner.partner_id}": must be a positive number`,
      );
    }

    if (typeof partner.rate_limit_window_minutes !== 'number' || partner.rate_limit_window_minutes <= 0) {
      throw new Error(
        `Invalid rate_limit_window_minutes for partner "${partner.partner_id}": must be a positive number`,
      );
    }
  }
}

export function validateDelegatedVerification(
  apiKeyHeader: string | undefined,
  delegatedPayload: DelegatedVerificationPayload,
  config: DelegatedVerificationConfig,
  requiredClaims: string[],
  claims: Record<string, string>,
): DelegatedValidationResult | DelegatedValidationError {
  // 1. Extract and validate API key from X-Partner-Api-Key header
  if (!apiKeyHeader) {
    return {
      valid: false,
      status: 401,
      code: 'invalid_partner_credentials',
      message: 'Missing X-Partner-Api-Key header',
    };
  }

  const keyHash = hashApiKey(apiKeyHeader);

  // 2. Find partner by API key hash
  const partner = config.trusted_partners.find((p) => p.api_key_hash === keyHash);
  if (!partner) {
    return {
      valid: false,
      status: 401,
      code: 'invalid_partner_credentials',
      message: 'Invalid API key',
    };
  }

  // 3. Verify partner_id matches
  if (delegatedPayload.partner_id !== partner.partner_id) {
    return {
      valid: false,
      status: 403,
      code: 'partner_not_authorized',
      message: 'partner_id does not match the authenticated partner',
    };
  }

  // 4. Check rate limit
  const now = Date.now();
  const windowMs = partner.rate_limit_window_minutes * 60 * 1000;
  let rateState = rateLimitState.get(partner.partner_id);

  if (!rateState || now - rateState.window_start > windowMs) {
    rateState = { count: 0, window_start: now };
    rateLimitState.set(partner.partner_id, rateState);
  }

  if (rateState.count >= partner.rate_limit) {
    return {
      valid: false,
      status: 429,
      code: 'rate_limited',
      message: `Partner exceeded rate limit (${partner.rate_limit} per ${partner.rate_limit_window_minutes} minutes)`,
    };
  }

  // 5. Validate verification freshness
  const maxAgeHours = config.max_verification_age_hours ?? 24;
  const verifiedAt = new Date(delegatedPayload.verified_at);
  if (isNaN(verifiedAt.getTime())) {
    return {
      valid: false,
      status: 400,
      code: 'stale_verification',
      message: 'Invalid verified_at timestamp format',
    };
  }

  const ageMs = now - verifiedAt.getTime();
  if (ageMs > maxAgeHours * 60 * 60 * 1000) {
    return {
      valid: false,
      status: 400,
      code: 'stale_verification',
      message: `Verification is too old (max ${maxAgeHours} hours)`,
    };
  }

  if (ageMs < -300_000) {
    // More than 5 minutes in the future — reject
    return {
      valid: false,
      status: 400,
      code: 'stale_verification',
      message: 'verified_at is in the future',
    };
  }

  // 6. Validate required claims are present and allowed
  for (const claim of requiredClaims) {
    if (!claims[claim]) {
      return {
        valid: false,
        status: 400,
        code: 'missing_claims',
        message: `Required claim "${claim}" not provided`,
      };
    }
    if (!partner.allowed_claims.includes(claim)) {
      return {
        valid: false,
        status: 403,
        code: 'partner_not_authorized',
        message: `Partner not authorized to vouch for claim "${claim}"`,
      };
    }
  }

  // 7. Basic email format check if email claim is present
  if (claims.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(claims.email)) {
    return {
      valid: false,
      status: 400,
      code: 'missing_claims',
      message: 'Invalid email format',
    };
  }

  // 8. Cross-check attested_claims against body.claims (bidirectional)
  const attestedClaims = delegatedPayload.attested_claims;

  // Every attested claim must exist and match in body.claims
  for (const [key, value] of Object.entries(attestedClaims)) {
    if (claims[key] === undefined) {
      return {
        valid: false,
        status: 400,
        code: 'claims_mismatch',
        message: `Attested claim "${key}" is missing from provided claims`,
      };
    }
    if (claims[key] !== value) {
      return {
        valid: false,
        status: 400,
        code: 'claims_mismatch',
        message: `Attested claim "${key}" does not match provided claim`,
      };
    }
  }

  // Every body.claim must be attested — reject unattested claims
  for (const key of Object.keys(claims)) {
    if (attestedClaims[key] === undefined) {
      return {
        valid: false,
        status: 400,
        code: 'claims_mismatch',
        message: `Claim "${key}" is not attested by the partner`,
      };
    }
  }

  // All checks passed — increment rate limit counter
  rateState.count++;

  return { valid: true, partner, payload: delegatedPayload };
}

/** Reset rate limit state (for testing). */
export function resetRateLimitState(): void {
  rateLimitState.clear();
}
