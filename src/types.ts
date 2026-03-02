// API types matching JOINING_SERVICE_API.md Section 9

export interface WellKnownHoloJoining {
  joining_service_url: string;
  happ_id: string;
  version: string;
}

export interface JoiningServiceInfo {
  happ: {
    id: string;
    name: string;
    description?: string;
    icon_url?: string;
  };
  http_gateways?: HttpGateway[];
  auth_methods: AuthMethod[];
  /** Absent when the service does not manage linker relay URLs. */
  linker_info?: {
    selection_mode: 'assigned' | 'client_choice';
    region_hints?: string[];
  };
  happ_bundle_url?: string;
  dna_modifiers?: DnaModifiers;
}

export interface HttpGateway {
  url: string;
  dna_hashes: string[];
  status: 'available' | 'degraded' | 'offline';
}

export type AuthMethod =
  | 'open'
  | 'email_code'
  | 'sms_code'
  | 'evm_signature'
  | 'solana_signature'
  | 'invite_code'
  | `x-${string}`;

export interface DnaModifiers {
  network_seed?: string;
  properties?: Record<string, unknown>;
}

export interface JoinRequest {
  agent_key: string;
  claims?: Record<string, string>;
}

export interface JoinResponse {
  session: string;
  status: 'ready' | 'pending' | 'rejected';
  challenges?: Challenge[];
  reason?: string;
  poll_interval_ms?: number;
}

export interface Challenge {
  id: string;
  type: AuthMethod;
  description: string;
  expires_at?: string;
  metadata?: Record<string, unknown>;
  completed?: boolean;
}

export interface VerifyRequest {
  challenge_id: string;
  response: string;
}

export interface VerifyResponse {
  status: 'ready' | 'pending' | 'rejected';
  challenges_remaining?: Challenge[];
  reason?: string;
  poll_interval_ms?: number;
}

export interface JoinProvision {
  /** Absent when the service does not manage linker relay URLs. */
  linker_urls?: string[];
  /** Absent when linker_urls is absent or expiry does not apply. */
  linker_urls_expire_at?: string;
  membrane_proofs?: Record<string, string>;
  happ_bundle_url?: string;
  dna_modifiers?: DnaModifiers;
}

export interface ReconnectRequest {
  agent_key: string;
  timestamp: string;
  signature: string;
}

export interface ReconnectResponse {
  /** Absent when the service does not manage linker relay URLs. */
  linker_urls?: string[];
  /** Absent when linker_urls is absent. */
  linker_urls_expire_at?: string;
  http_gateways?: HttpGateway[];
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
}
