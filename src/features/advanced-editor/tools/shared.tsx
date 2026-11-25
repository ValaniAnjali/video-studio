import type { ReactNode } from 'react'

export function ToolSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-2.5 border-b border-line px-3.5 py-3.5">
      <div>
        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
        {hint && <p className="mt-1 text-xs leading-relaxed text-muted/80">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/** "1:23", "01:23.5" or "83" (seconds) -> seconds, or null if it can't be read. */
export function parseTime(input: string): number | null {
  const parts = input.trim().split(':')
  if (parts.length > 3 || parts.some((p) => p === '' || Number.isNaN(Number(p)))) return null
  return parts.reduce((acc, p) => acc * 60 + Number(p), 0)
}
