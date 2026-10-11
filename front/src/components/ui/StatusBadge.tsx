import type { ReactNode } from 'react';

export type Tone = 'blue' | 'green' | 'amber' | 'red' | 'slate';

export function StatusBadge({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`status tone-${tone}`}>{children}</span>;
}
