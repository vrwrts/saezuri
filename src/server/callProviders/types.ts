// Every archive we draw from carries CC licences obliging us to name the
// recordist wherever the recording plays. That is why the credit fields below
// are required: a candidate we cannot credit is not a candidate.

export interface CallCandidate {
  audioUrl: string
  /** No leading dot. */
  ext: string
  /** Empty when the archive names none. */
  recordist: string
  license: string
  licenseUrl?: string
  sourceUrl: string
  sourceName: string
}

export interface CallProvider {
  /** Stable id, as used in CALL_PROVIDERS. */
  name: string
  /**
   * Resolves to null when the archive genuinely has nothing — a settled answer
   * the caller is free to remember. **Throws** for anything transient (rate
   * limit, 5xx, network), so a passing failure is retried later rather than
   * cached as a permanent miss.
   */
  find(scientificName: string, signal?: AbortSignal): Promise<CallCandidate | null>
}
