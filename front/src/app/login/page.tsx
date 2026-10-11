'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { BrandMark } from '@/components/shell/BrandMark';
import { APP_NAME } from '@/components/shell/Sidebar';
import { errorMessage } from '@/lib/api/client';
import type { UserTenant } from '@/lib/api/types';
import { homeFor } from '@/lib/auth/permissions';
import { useSession } from '@/lib/auth/session';
import { ROLE_LABEL } from '@/lib/format';

/** Solo se aceptan rutas internas en ?next= (evita redirecciones abiertas hacia otros sitios). */
function safeNext(): string | null {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/login') ? next : null;
}

const FEATURES = [
  { icon: 'bi-receipt-cutoff', title: 'Factura electrónica ARCA', text: 'Comprobantes A, B y C con CAE y QR, notas de crédito y transparencia fiscal (Ley 27.743).' },
  { icon: 'bi-shop-window', title: 'Todas tus sucursales en un tablero', text: 'Ventas, margen, caja y stock por local, comparados contra el período anterior.' },
  { icon: 'bi-arrow-left-right', title: 'Stock que se mueve solo', text: 'Matriz por sucursal, transferencias con remito y reposición sugerida antes del quiebre.' },
  { icon: 'bi-graph-up', title: 'Precios al día con la inflación', text: 'Aumentos masivos por rubro, marca o proveedor con vista previa y redondeo comercial.' },
];

export default function LoginPage() {
  const { login, status, user } = useSession();
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tenantChoices, setTenantChoices] = useState<UserTenant[] | null>(null);

  useEffect(() => {
    // Mientras se ingresa (busy) no se redirige: puede faltar elegir la empresa.
    if (status === 'authenticated' && !busy && !tenantChoices) router.replace(safeNext() ?? homeFor(user?.role));
  }, [status, user, router, tenantChoices, busy]);

  const enter = async (tenantId?: string) => {
    setBusy(true);
    setError(null);
    try {
      const { tenants } = await login({ username: username.trim(), password, tenantId });
      if (!tenantId && tenants.length > 1) {
        setTenantChoices(tenants);
        return;
      }
      setPassword('');
      setTenantChoices(null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!username.trim() || password.length < 6) {
      setError('Ingresá tu usuario y una contraseña de al menos 6 caracteres.');
      return;
    }
    void enter();
  };

  return (
    <div className="login-shell">
      <aside className="login-aside">
        <div className="d-flex align-items-center gap-2">
          <BrandMark />
          <span className="fw-semibold text-white">{APP_NAME}</span>
        </div>
        <div>
          <div className="eyebrow mb-3" style={{ color: 'var(--celeste)' }}>
            Gestión comercial para empresas argentinas
          </div>
          <h2 className="mb-4">Vendé, facturá y reponé en todas tus sucursales desde un solo lugar.</h2>
          {FEATURES.map((feature) => (
            <div key={feature.title} className="login-feature">
              <i className={`bi ${feature.icon}`} aria-hidden="true" />
              <div>
                <strong>{feature.title}</strong>
                <span>{feature.text}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="small" style={{ color: 'var(--ink-400)' }}>
          Datos protegidos según la Ley 25.326 · Conexión cifrada · Sesión con renovación segura
        </div>
      </aside>

      <main className="login-form-wrap">
        <div className="login-card">
          <div className="d-lg-none d-flex align-items-center gap-2 mb-4">
            <BrandMark />
            <span className="fw-semibold">{APP_NAME}</span>
          </div>

          {tenantChoices ? (
            <>
              <div className="eyebrow">Paso 2 de 2</div>
              <h1 className="h4 mt-1 mb-1">Elegí la empresa</h1>
              <p className="text-muted-2 small mb-4">Tu usuario tiene acceso a más de una empresa.</p>
              {tenantChoices.map((tenant) => (
                <button key={tenant.id} type="button" className="tenant-option" disabled={busy} onClick={() => void enter(tenant.id)}>
                  <span className="avatar">{(tenant.tradeName || tenant.legalName).slice(0, 2).toUpperCase()}</span>
                  <span className="flex-grow-1">
                    <span className="d-block fw-semibold text-ink">{tenant.tradeName || tenant.legalName}</span>
                    <span className="d-block small text-muted-2">{ROLE_LABEL[tenant.role]}</span>
                  </span>
                  <i className="bi bi-chevron-right text-muted-2" aria-hidden="true" />
                </button>
              ))}
              {error && <div className="alert alert-danger small py-2 mt-3">{error}</div>}
            </>
          ) : (
            <form onSubmit={onSubmit} noValidate>
              <div className="eyebrow">Acceso seguro</div>
              <h1 className="h4 mt-1 mb-1">Ingresá a tu cuenta</h1>
              <p className="text-muted-2 small mb-4">Usá el usuario que te asignó el administrador de la empresa.</p>

              <div className="mb-3">
                <label htmlFor="username" className="form-label">
                  Usuario
                </label>
                <input
                  id="username"
                  className="form-control"
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  maxLength={150}
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoFocus
                />
              </div>
              <div className="mb-3">
                <label htmlFor="password" className="form-label">
                  Contraseña
                </label>
                <div className="input-group">
                  <input
                    id="password"
                    className="form-control"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    maxLength={128}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                  <button type="button" className="btn btn-outline-secondary" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}>
                    <i className={`bi ${showPassword ? 'bi-eye-slash' : 'bi-eye'}`} />
                  </button>
                </div>
              </div>

              {error && (
                <div className="alert alert-danger small py-2 d-flex gap-2" role="alert">
                  <i className="bi bi-exclamation-circle" aria-hidden="true" />
                  <span>{error}</span>
                </div>
              )}

              <button type="submit" className="btn btn-primary w-100 py-2" disabled={busy}>
                {busy ? <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" /> : <i className="bi bi-box-arrow-in-right me-2" aria-hidden="true" />}
                Ingresar
              </button>

              <p className="form-hint mt-3 mb-0">
                Por seguridad, después de varios intentos fallidos el acceso se bloquea por unos minutos. Si olvidaste tu contraseña, pedile al administrador que la restablezca.
              </p>
            </form>
          )}
        </div>
      </main>
    </div>
  );
}
