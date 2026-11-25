import { useEffect, useRef, useState, type ButtonHTMLAttributes, type DragEvent, type InputHTMLAttributes, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Upload, X } from 'lucide-react'
import { cn } from '@/utils/cn'
import { useToasts } from '@/store/toastStore'

// ---------- Button ----------

type Variant = 'primary' | 'ghost' | 'subtle' | 'danger'
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'icon'
  active?: boolean
}

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-fg font-semibold hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100',
  ghost: 'text-fg hover:bg-raise disabled:opacity-35 disabled:hover:bg-transparent',
  subtle: 'bg-raise text-fg hover:bg-[#2b3140] disabled:opacity-35',
  danger: 'bg-bad/15 text-bad hover:bg-bad/25 disabled:opacity-35',
}

export function Button({ variant = 'subtle', size = 'md', active, className, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md transition-colors select-none whitespace-nowrap',
        size === 'md' && 'h-9 px-3.5 text-sm',
        size === 'sm' && 'h-7 px-2.5 text-xs',
        size === 'icon' && 'h-8 w-8',
        VARIANTS[variant],
        active && 'bg-raise text-accent ring-1 ring-accent/50',
        className,
      )}
    />
  )
}

// ---------- Modal ----------

export function Modal({ open, onClose, title, children, wide, locked }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; locked?: boolean }) {
  useEffect(() => {
    if (!open || locked) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose, locked])
  if (!open) return null
  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-4" onMouseDown={(e) => e.target === e.currentTarget && !locked && onClose()}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cn('max-h-[90vh] w-full overflow-y-auto rounded-xl border border-line bg-panel shadow-2xl', wide ? 'max-w-2xl' : 'max-w-md')}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          {!locked && (
            <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
              <X size={16} />
            </Button>
          )}
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>,
    document.body,
  )
}

// ---------- form fields ----------

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted/80">{hint}</span>}
    </label>
  )
}

const inputCls = 'h-9 w-full rounded-md border border-line bg-bg px-2.5 text-sm text-fg placeholder:text-muted/60 focus:border-accent focus:outline-none'

export const TextInput = (p: InputHTMLAttributes<HTMLInputElement>) => <input {...p} className={cn(inputCls, p.className)} />

export function Select<T extends string | number>({ value, onChange, options, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; className?: string }) {
  return (
    <select
      value={String(value)}
      onChange={(e) => {
        const raw = e.target.value
        const match = options.find((o) => String(o.value) === raw)!
        onChange(match.value)
      }}
      className={cn(inputCls, 'pr-7', className)}
    >
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function Progress({ value, label }: { value: number; label?: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div>
      <div className="h-2 overflow-hidden rounded-full bg-raise" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-accent transition-[width] duration-150" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="font-mono">{pct}%</span>
      </div>
    </div>
  )
}

// ---------- DropZone ----------

export function DropZone({ onFiles, accept, multiple, children, className }: { onFiles: (f: File[]) => void; accept?: string; multiple?: boolean; children?: ReactNode; className?: string }) {
  const [over, setOver] = useState(false)
  const ref = useRef<HTMLInputElement>(null)
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const files = [...e.dataTransfer.files]
    if (files.length) onFiles(multiple ? files : files.slice(0, 1))
  }
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      onClick={() => ref.current?.click()}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && ref.current?.click()}
      role="button"
      tabIndex={0}
      className={cn('grid cursor-pointer place-items-center rounded-xl border-2 border-dashed border-line bg-panel/60 p-8 text-center transition-colors hover:border-muted', over && 'border-accent bg-accent/5', className)}
    >
      <input
        ref={ref}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          if (files.length) onFiles(files)
          e.target.value = ''
        }}
      />
      {children ?? (
        <div className="flex flex-col items-center gap-2 text-muted">
          <Upload size={22} />
          <span className="text-sm">Drop a file here or click to browse</span>
        </div>
      )}
    </div>
  )
}

// ---------- Toaster ----------

export function Toaster() {
  const { toasts, dismiss } = useToasts()
  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            'pointer-events-auto flex items-start gap-2 rounded-lg border bg-panel2 p-3 text-sm shadow-xl',
            t.kind === 'error' ? 'border-bad/50' : t.kind === 'success' ? 'border-ok/50' : 'border-line',
          )}
        >
          <span className="flex-1">{t.message}</span>
          <button onClick={() => dismiss(t.id)} className="text-muted hover:text-fg" aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body,
  )
}

// ---------- misc ----------

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-bg px-1.5 py-0.5 font-mono text-[10px] text-muted">{children}</kbd>
}
