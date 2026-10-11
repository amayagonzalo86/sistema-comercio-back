/** Isotipo: sol estilizado sobre recuadro de comprobante (identidad comercial argentina, sin símbolos patrios oficiales). */
export function BrandMark({ className = 'brand-mark' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" aria-hidden="true">
      <rect x="1" y="1" width="38" height="38" rx="9" fill="#1c4f8c" />
      <rect x="1" y="1" width="38" height="38" rx="9" fill="url(#brand-gloss)" />
      <defs>
        <linearGradient id="brand-gloss" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#74acdf" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#1c4f8c" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g stroke="#f3c24b" strokeWidth="2" strokeLinecap="round">
        {Array.from({ length: 8 }, (_, index) => {
          const angle = (index * Math.PI) / 4;
          return (
            <line
              key={index}
              x1={(20 + Math.cos(angle) * 9.5).toFixed(2)}
              y1={(20 + Math.sin(angle) * 9.5).toFixed(2)}
              x2={(20 + Math.cos(angle) * 13).toFixed(2)}
              y2={(20 + Math.sin(angle) * 13).toFixed(2)}
            />
          );
        })}
      </g>
      <circle cx="20" cy="20" r="6.5" fill="#f3c24b" />
    </svg>
  );
}
