import { create } from 'zustand'

export interface Toast {
  id: number
  kind: 'info' | 'error' | 'success'
  message: string
}

interface ToastState {
  toasts: Toast[]
  push(kind: Toast['kind'], message: string): void
  dismiss(id: number): void
}

let next = 1

export const useToasts = create<ToastState>((set, get) => ({
  toasts: [],
  push: (kind, message) => {
    const id = next++
    set({ toasts: [...get().toasts, { id, kind, message }].slice(-4) })
    setTimeout(() => get().dismiss(id), kind === 'error' ? 8000 : 4000)
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}))

export const toast = {
  info: (m: string) => useToasts.getState().push('info', m),
  error: (m: string) => useToasts.getState().push('error', m),
  success: (m: string) => useToasts.getState().push('success', m),
}
