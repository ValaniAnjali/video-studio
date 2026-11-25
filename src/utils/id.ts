let counter = 0
let override: (() => string) | null = null

/** Unique id. Tests can install a deterministic generator. */
export function uid(): string {
  if (override) return override()
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `id-${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

export function setIdGenerator(fn: (() => string) | null) {
  override = fn
}
