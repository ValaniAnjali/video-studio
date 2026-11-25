/**
 * Tiny in-memory hand-off for File objects between routes (File objects cannot travel
 * through router state or URLs). Consumed once.
 */
let pending: File[] | null = null

export const setPendingFiles = (files: File[]) => {
  pending = files
}

export function takePendingFiles(): File[] {
  const f = pending ?? []
  pending = null
  return f
}
