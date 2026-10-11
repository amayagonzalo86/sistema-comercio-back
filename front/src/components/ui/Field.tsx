import type { ReactNode } from 'react';

interface FieldProps {
  label: string;
  htmlFor?: string;
  hint?: ReactNode;
  required?: boolean;
  className?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, required, className = '', children }: FieldProps) {
  return (
    <div className={className}>
      <label className="form-label" htmlFor={htmlFor}>
        {label}
        {required && <span className="text-danger ms-1">*</span>}
      </label>
      {children}
      {hint && <div className="form-hint">{hint}</div>}
    </div>
  );
}
