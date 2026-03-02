import type { HttpGateway, LinkerUrl } from '../types.js';

/**
 * Provides the current set of linker WebSocket URLs and HTTP gateway URLs.
 * Implementations may read from static config, Cloudflare KV, a database,
 * or any other dynamic source.
 *
 * Each URL entry carries an optional `expires_at` field so that clients can
 * know exactly when an individual URL stops being valid and reconnect proactively.
 */
export interface UrlProvider {
  /**
   * Returns the ordered list of linker URL entries for this deployment,
   * or undefined if this service does not manage linker relay URLs.
   * Each entry may include an optional `expires_at` (ISO 8601).
   */
  getLinkerUrls(): Promise<LinkerUrl[] | undefined>;

  /**
   * Returns the list of read-only HTTP gateway instances,
   * or undefined if this service does not publish gateway information.
   * Each entry may include an optional `expires_at` (ISO 8601).
   */
  getHttpGateways(): Promise<HttpGateway[] | undefined>;
}
