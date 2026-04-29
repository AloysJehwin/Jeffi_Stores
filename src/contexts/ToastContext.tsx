'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { createPortal } from 'react-dom'

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface Toast {
  id: string
  message: string
  type: ToastType
}

interface ConfirmDialog {
  title: string
  message: string
  onConfirm: () => void
  onCancel: () => void
  confirmText?: string
  cancelText?: string
  type?: 'danger' | 'warning' | 'info'
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void
  showConfirm: (options: Omit<ConfirmDialog, 'onCancel'>) => Promise<boolean>
}

const ToastContext = createContext<ToastContextType | undefined>(undefined)

const BG: Record<ToastType, string> = {
  success: 'bg-green-50 border-green-200 text-green-800 dark:bg-green-900/30 dark:border-green-800 dark:text-green-300',
  error:   'bg-red-50 border-red-200 text-red-800 dark:bg-red-900/30 dark:border-red-800 dark:text-red-300',
  warning: 'bg-yellow-50 border-yellow-200 text-yellow-800 dark:bg-yellow-900/30 dark:border-yellow-800 dark:text-yellow-300',
  info:    'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300',
}

function ToastItem({ toast, index, total, onRemove }: { toast: Toast; index: number; total: number; onRemove: () => void }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { setMounted(true) }, [])

  const bottomOffset = 16 + (total - 1 - index) * 58

  if (!mounted) return null

  return createPortal(
    <div
      className={`animate-slide-in-right fixed z-[9999] flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border max-w-sm ${BG[toast.type]}`}
      style={{ bottom: bottomOffset, right: 16 }}
    >
      {toast.type === 'success' && <svg className="w-5 h-5 text-green-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
      {toast.type === 'error' && <svg className="w-5 h-5 text-red-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>}
      {toast.type === 'warning' && <svg className="w-5 h-5 text-yellow-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>}
      {toast.type === 'info' && <svg className="w-5 h-5 text-blue-600 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>}
      <p className="text-sm font-medium">{toast.message}</p>
      <button type="button" onClick={onRemove} className="shrink-0 text-foreground-muted hover:text-foreground-secondary transition-colors" aria-label="Close">
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
      </button>
    </div>,
    document.body
  )
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialog | null>(null)

  function showToast(message: string, type: ToastType = 'info') {
    const id = Math.random().toString(36).substring(7)
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }

  function removeToast(id: string) {
    setToasts(prev => prev.filter(t => t.id !== id))
  }

  function showConfirm(options: Omit<ConfirmDialog, 'onCancel'>): Promise<boolean> {
    return new Promise(resolve => {
      setConfirmDialog({
        ...options,
        onConfirm: () => { options.onConfirm(); setConfirmDialog(null); resolve(true) },
        onCancel:  () => { setConfirmDialog(null); resolve(false) },
      })
    })
  }

  return (
    <ToastContext.Provider value={{ showToast, showConfirm }}>
      {children}

      {confirmDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 backdrop-blur-sm bg-black/30">
          <div className="bg-surface-elevated rounded-lg shadow-xl max-w-md w-full p-6 animate-fade-in">
            <h3 className="text-lg font-bold text-foreground mb-2">{confirmDialog.title}</h3>
            <p className="text-foreground-secondary mb-6">{confirmDialog.message}</p>
            <div className="flex gap-3 justify-end">
              <button type="button" onClick={confirmDialog.onCancel} className="px-4 py-2 bg-surface-secondary hover:bg-border-default text-foreground-secondary rounded-lg font-medium transition-colors">
                {confirmDialog.cancelText || 'Cancel'}
              </button>
              <button type="button" onClick={confirmDialog.onConfirm} className={`px-4 py-2 text-white rounded-lg font-medium transition-colors ${confirmDialog.type === 'danger' || confirmDialog.type === 'warning' ? 'bg-red-600 hover:bg-red-700' : 'bg-accent-600 hover:bg-accent-700'}`}>
                {confirmDialog.confirmText || 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toasts.map((toast, index) => (
        <ToastItem
          key={toast.id}
          toast={toast}
          index={index}
          total={toasts.length}
          onRemove={() => removeToast(toast.id)}
        />
      ))}
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used within a ToastProvider')
  return context
}
