import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import type { ReactNode } from 'react'

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
      <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-accent-fg">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <path d="M8 5v14l11-7z" />
        </svg>
      </span>
      Video Studio
    </Link>
  )
}

export function PageHeader({ title, back, right }: { title?: string; back?: string; right?: ReactNode }) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-4 border-b border-line px-5">
      {back ? (
        <Link to={back} className="flex items-center gap-1.5 text-sm text-muted hover:text-fg">
          <ArrowLeft size={16} /> Back
        </Link>
      ) : (
        <Logo />
      )}
      {title && <h1 className="text-sm font-medium text-muted">{title}</h1>}
      <div className="ml-auto flex items-center gap-2">{right}</div>
    </header>
  )
}
