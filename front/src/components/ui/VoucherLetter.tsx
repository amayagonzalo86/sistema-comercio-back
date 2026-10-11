import type { VoucherClass } from '@/lib/api/types';

/** Recuadro con la letra del comprobante, como en la factura impresa argentina (RG 1415). */
export function VoucherLetter({ letter, code, size = 'sm' }: { letter: VoucherClass | string; code?: number; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className={`voucher-letter size-${size}`} title={`Comprobante ${letter}`}>
      <span className="letter">{letter}</span>
      {code !== undefined && <span className="code">COD. {String(code).padStart(3, '0')}</span>}
    </span>
  );
}
