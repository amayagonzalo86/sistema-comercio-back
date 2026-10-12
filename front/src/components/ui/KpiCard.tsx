import type { ReactNode } from 'react';
import { Sparkline } from '@/components/charts/Sparkline';

interface KpiCardProps {
  label: string;
  icon: string;
  value: ReactNode;
  foot?: ReactNode;
  spark?: number[];
  loading?: boolean;
}

export function KpiCard({ label, icon, value, foot, spark, loading }: KpiCardProps) {
  return (
    <div className="surface kpi">
      <div className="kpi-label">
        <i className={`bi ${icon}`} aria-hidden="true" />
        {label}
      </div>
      {loading ? <div className="skeleton mt-2" style={{ height: 30, width: '60%' }} /> : <div className="kpi-value">{value}</div>}
      {foot && <div className="kpi-foot">{foot}</div>}
      {spark && !loading && (
        <div className="kpi-spark d-none d-xxl-block">
          <Sparkline values={spark} />
        </div>
      )}
    </div>
  );
}
