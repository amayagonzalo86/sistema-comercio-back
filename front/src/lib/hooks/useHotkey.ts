'use client';

import { useEffect, useRef } from 'react';

/**
 * Atajo de teclado global. `combo` acepta "F2", "F9", "Escape", "mod+k" (Ctrl en Windows/Linux, Cmd en Mac).
 * Las teclas de función funcionan aun con el foco en un campo de texto (uso típico de caja).
 */
export function useHotkey(combo: string, handler: (event: KeyboardEvent) => void, enabled = true): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;
    const parts = combo.toLowerCase().split('+');
    const key = parts[parts.length - 1];
    const needsMod = parts.includes('mod');
    const listener = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== key) return;
      if (needsMod !== (event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      handlerRef.current(event);
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [combo, enabled]);
}
