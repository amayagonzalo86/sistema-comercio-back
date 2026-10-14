'use client';

import { useId, useState } from 'react';

/** Mismas reglas que el backend: 10 a 128 caracteres con mayúsculas, minúsculas y números. */
export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 128;

export function passwordChecks(value: string) {
  return [
    { ok: value.length >= PASSWORD_MIN && value.length <= PASSWORD_MAX, label: `${PASSWORD_MIN} caracteres o más` },
    { ok: /[a-z]/.test(value), label: 'Una minúscula' },
    { ok: /[A-Z]/.test(value), label: 'Una mayúscula' },
    { ok: /\d/.test(value), label: 'Un número' },
  ];
}

export function isStrongPassword(value: string): boolean {
  return passwordChecks(value).every((check) => check.ok);
}

/** Contraseña aleatoria con el generador criptográfico del navegador (sin caracteres ambiguos como O/0 o l/1). */
export function generatePassword(length = 14): string {
  const lower = 'abcdefghijkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const all = lower + upper + digits;
  const random = (max: number) => {
    const values = new Uint32Array(1);
    // Rechazo de valores sesgados: distribución uniforme.
    const limit = Math.floor(0x1_0000_0000 / max) * max;
    do crypto.getRandomValues(values);
    while (values[0] >= limit);
    return values[0] % max;
  };
  const chars = [lower[random(lower.length)], upper[random(upper.length)], digits[random(digits.length)]];
  while (chars.length < length) chars.push(all[random(all.length)]);
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = random(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  /** Muestra la lista de requisitos y el botón para generar una contraseña. */
  withRules?: boolean;
  autoComplete?: 'new-password' | 'current-password';
  autoFocus?: boolean;
}

export function PasswordField({ label, value, onChange, withRules = false, autoComplete = 'new-password', autoFocus }: PasswordFieldProps) {
  const inputId = useId();
  const [visible, setVisible] = useState(false);
  const [copied, setCopied] = useState(false);

  const generate = () => {
    onChange(generatePassword());
    setVisible(true);
    setCopied(false);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div>
      <label className="form-label" htmlFor={inputId}>
        {label}
      </label>
      <div className="input-group">
        <input
          id={inputId}
          className="form-control mono"
          type={visible ? 'text' : 'password'}
          value={value}
          maxLength={PASSWORD_MAX}
          autoComplete={autoComplete}
          spellCheck={false}
          data-autofocus={autoFocus ? true : undefined}
          onChange={(event) => {
            onChange(event.target.value);
            setCopied(false);
          }}
        />
        <button type="button" className="btn btn-outline-secondary" onClick={() => setVisible((current) => !current)} aria-label={visible ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
          <i className={`bi ${visible ? 'bi-eye-slash' : 'bi-eye'}`} aria-hidden="true" />
        </button>
        {withRules && (
          <>
            <button type="button" className="btn btn-outline-secondary" onClick={generate} title="Generar una contraseña segura">
              <i className="bi bi-magic" aria-hidden="true" />
              <span className="visually-hidden">Generar</span>
            </button>
            {visible && value && (
              <button type="button" className="btn btn-outline-secondary" onClick={() => void copy()} title="Copiar">
                <i className={`bi ${copied ? 'bi-clipboard-check' : 'bi-clipboard'}`} aria-hidden="true" />
                <span className="visually-hidden">Copiar</span>
              </button>
            )}
          </>
        )}
      </div>
      {withRules && (
        <ul className="list-unstyled d-flex flex-wrap gap-3 small mt-2 mb-0">
          {passwordChecks(value).map((check) => (
            <li key={check.label} className={check.ok ? 'text-success' : 'text-muted-2'}>
              <i className={`bi ${check.ok ? 'bi-check-circle-fill' : 'bi-circle'} me-1`} aria-hidden="true" />
              {check.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
