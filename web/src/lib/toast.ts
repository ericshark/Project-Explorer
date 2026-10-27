import { useSyncExternalStore } from 'react'

export interface Toast {
  id: number
  message: string
  tone: 'error' | 'info'
}

let toasts: Toast[] = []
let nextId = 1
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((toast) => toast.id !== id)
  emit()
}

export function toast(message: string, tone: Toast['tone'] = 'info'): void {
  const id = nextId++
  toasts = [...toasts, { id, message, tone }]
  emit()
  window.setTimeout(() => dismissToast(id), tone === 'error' ? 7000 : 3000)
}

export function toastError(error: unknown): void {
  toast(error instanceof Error ? error.message : String(error), 'error')
}

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => toasts,
  )
}
