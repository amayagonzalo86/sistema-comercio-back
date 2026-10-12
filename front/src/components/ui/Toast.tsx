'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type ToastKind = 'success' | 'error' | 'info';

interface ToastMessage {
  id: number;
  kind: ToastKind;
  title: string;
  detail?: string;
}

interface ToastApi {
  success: (title: string, detail?: string) => void;
  error: (title: string, detail?: string) => void;
  info: (title: string, detail?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);
const ICONS: Record<ToastKind, string> = { success: 'bi-check-circle-fill', error: 'bi-x-octagon-fill', info: 'bi-info-circle-fill' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const push = useCallback((kind: ToastKind, title: string, detail?: string) => {
    const id = Date.now() + Math.random();
    setMessages((current) => [...current.slice(-3), { id, kind, title, detail }]);
    setTimeout(() => setMessages((current) => current.filter((item) => item.id !== id)), kind === 'error' ? 7000 : 4000);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (title, detail) => push('success', title, detail),
      error: (title, detail) => push('error', title, detail),
      info: (title, detail) => push('info', title, detail),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {messages.map((message) => (
          <div key={message.id} className={`toast-item ${message.kind}`} role={message.kind === 'error' ? 'alert' : 'status'}>
            <i className={`bi ${ICONS[message.kind]}`} aria-hidden="true" />
            <div>
              <div>{message.title}</div>
              {message.detail && <div className="toast-sub">{message.detail}</div>}
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast debe usarse dentro de <ToastProvider>.');
  return context;
}
