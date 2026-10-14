export const CALL_PROVIDER_NAMES = ['birdnet', 'commons'] as const
export type CallProviderName = (typeof CALL_PROVIDER_NAMES)[number]

const DEFAULT_CALL_PROVIDERS: readonly CallProviderName[] = ['commons']

export function parseCallProviders(raw: string | undefined): CallProviderName[] {
  if (raw === undefined) return [...DEFAULT_CALL_PROVIDERS]
  if (raw.trim() === '') return []

  const valid = new Set<string>(CALL_PROVIDER_NAMES)
  const seen = new Set<string>()
  const out: CallProviderName[] = []
  for (const value of raw.split(',')) {
    const name = value.trim().toLowerCase()
    if (!valid.has(name) || seen.has(name)) continue
    seen.add(name)
    out.push(name as CallProviderName)
  }
  return out.length > 0 ? out : [...DEFAULT_CALL_PROVIDERS]
}
