export interface CallDetection {
  id: number
  /** Basename only; an empty name means BirdNET-Go did not save a clip. */
  clipName: string
}

export interface CallLookup {
  scientificName: string
  /** Newest first. Archive providers may ignore these. */
  detections: readonly CallDetection[]
  current?: { provider: string; sourceKey?: string }
}

export interface CallCandidate {
  audioUrl?: string
  /** Providers that already fetched the candidate can hand the bytes through. */
  bytes?: Uint8Array
  /** No leading dot. */
  ext: string
  /** Immutable provider-local identity, used to avoid downloading it twice. */
  sourceKey?: string
  /** Empty when the archive names none. */
  recordist: string
  license?: string
  licenseUrl?: string
  sourceUrl?: string
  sourceName: string
}

export interface CallProvider {
  /** Stable id, as used in CALL_PROVIDERS. */
  name: string
  /** Identity of the newest input this provider could resolve. */
  sourceKey?(lookup: CallLookup): string | undefined
  /**
   * Resolves to null when the source genuinely has nothing — a settled answer
   * the caller is free to remember. **Throws** when the response is not a
   * settled miss (rate limit, server/network or configuration error), so a
   * fixable failure is retried later rather than cached as permanent.
   */
  find(lookup: CallLookup, signal?: AbortSignal): Promise<CallCandidate | null>
}
