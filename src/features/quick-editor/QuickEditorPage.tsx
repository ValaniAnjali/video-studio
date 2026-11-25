import { Link } from 'react-router-dom'
import { PageHeader } from '@/app/Brand'
import { cn } from '@/utils/cn'
import { TOOLS } from './tools'

export default function QuickEditorPage() {
  return (
    <div className="flex h-full flex-col">
      <PageHeader back="/" title="Quick Editor" />
      <div className="page-scroll flex-1">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <h1 className="text-3xl font-semibold tracking-tight">What do you want to do?</h1>
          <p className="mt-2 text-muted">Pick a tool, drop in a file, download the result. Nothing is uploaded.</p>
          <ul className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {TOOLS.map((t) => {
              const Icon = t.icon
              const body = (
                <>
                  <Icon size={20} className={t.comingSoon ? 'text-muted' : 'text-accent'} />
                  <p className="mt-3 font-medium">
                    {t.name} {t.comingSoon && <span className="ml-1 rounded bg-raise px-1.5 py-0.5 text-[10px] font-normal text-muted">SOON</span>}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">{t.blurb}</p>
                </>
              )
              return (
                <li key={t.id}>
                  {t.comingSoon ? (
                    <div className="h-full rounded-xl border border-line bg-panel/50 p-5 opacity-60">{body}</div>
                  ) : (
                    <Link to={`/quick/${t.id}`} className={cn('block h-full rounded-xl border border-line bg-panel p-5 transition-colors hover:border-accent/60')}>
                      {body}
                    </Link>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
}
