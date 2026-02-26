export interface MembraneProofGenerator {
  generate(
    agentKey: string,
    dnaHashes: string[],
    metadata?: Record<string, unknown>,
  ): Promise<Record<string, Uint8Array>>;
}
