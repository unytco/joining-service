import type { AgentPubKeyB64, AuthMethodEntry, DnaModifiers } from './types.js';
import type { HcAuthConfig } from './hc-auth/index.js';
import type { LinkerAuthConfig } from './linker-auth/index.js';

export interface ServiceConfig {
  happ: {
    id: string;
    name: string;
    description?: string;
    icon_url?: string;
    happ_bundle_url?: string;
  };
  auth_methods: AuthMethodEntry[];
  linker_info?: {
    selection_mode: 'assigned' | 'client_choice';
    region_hints?: string[];
  };
  dna_hashes?: string[];
  dna_modifiers?: DnaModifiers;
  membrane_proof?: {
    enabled: boolean;
    signing_key_path?: string;
  };
  email?: {
    provider: 'postmark' | 'sendgrid' | 'file';
    api_key?: string;
    from?: string;
    template?: string;
    output_dir?: string;
  };
  base_url?: string;
  invite_codes?: string[];
  allowed_agents?: AgentPubKeyB64[];
  session?: {
    store: 'memory' | 'sqlite' | 'cloudflare-kv';
    db_path?: string;
    pending_ttl_seconds?: number;
    ready_ttl_seconds?: number;
  };
  reconnect?: {
    enabled: boolean;
    timestamp_tolerance_seconds?: number;
  };
  port?: number;
  hc_auth?: HcAuthConfig;
  linker_auth?: LinkerAuthConfig;
}

const DEFAULTS = {
  session: {
    store: 'memory' as const,
    pending_ttl_seconds: 3600,
    ready_ttl_seconds: 86400,
  },
  reconnect: {
    enabled: true,
    timestamp_tolerance_seconds: 300,
  },
  port: 3000,
};

export function resolveConfig(partial: Partial<ServiceConfig>): ServiceConfig {
  if (!partial.happ?.id || !partial.happ?.name) {
    throw new Error('config: happ.id and happ.name are required');
  }
  if (!partial.auth_methods?.length) {
    throw new Error('config: at least one auth_method is required');
  }

  return {
    ...partial,
    happ: partial.happ,
    auth_methods: partial.auth_methods,
    session: { ...DEFAULTS.session, ...partial.session },
    reconnect: { ...DEFAULTS.reconnect, ...partial.reconnect },
    port: partial.port ?? DEFAULTS.port,
  };
}
