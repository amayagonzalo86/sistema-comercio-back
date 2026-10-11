'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { decodeClaims, onSessionChange, refreshSession, sessionStore } from '../api/client';
import { authApi, branchesApi } from '../api/endpoints';
import type { Branch, LoginRequest, LoginResponse, TenantRole, UserTenant, Uuid } from '../api/types';
import { BRANCH_SCOPED_ROLES, can, type Capability } from './permissions';

export interface SessionUser {
  id: Uuid;
  username: string;
  displayName: string;
  tenantId: Uuid;
  role: TenantRole;
}

type SessionStatus = 'loading' | 'authenticated' | 'anonymous';

interface SessionContextValue {
  status: SessionStatus;
  user: SessionUser | null;
  tenant: UserTenant | null;
  tenants: UserTenant[];
  branches: Branch[];
  /** Sucursal en la que se opera (ventas, caja, stock). null = todas (solo titular/administración). */
  activeBranchId: Uuid | null;
  activeBranch: Branch | null;
  /** true si el usuario no puede cambiar de sucursal (cajero, vendedor, depósito o encargado asignado). */
  branchLocked: boolean;
  setActiveBranchId: (branchId: Uuid | null) => void;
  login: (credentials: LoginRequest) => Promise<{ tenants: UserTenant[] }>;
  logout: () => Promise<void>;
  can: (capability: Capability) => boolean;
  reloadBranches: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/** Preferencia de interfaz (no es un dato sensible): última sucursal elegida en este navegador. */
const BRANCH_PREFERENCE_KEY = 'erp.activeBranch';
const NAME_PREFERENCE_KEY = 'erp.displayName';

/** El nombre visible se guarda solo para esta pestaña (sessionStorage); la sucursal elegida, en el navegador. */
function storageFor(key: string): Storage {
  return key === NAME_PREFERENCE_KEY ? window.sessionStorage : window.localStorage;
}

function readPreference(key: string): string | null {
  try {
    return storageFor(key).getItem(key);
  } catch {
    return null;
  }
}

function writePreference(key: string, value: string | null): void {
  try {
    if (value === null) storageFor(key).removeItem(key);
    else storageFor(key).setItem(key, value);
  } catch {
    // Navegación privada o almacenamiento bloqueado: la preferencia simplemente no se recuerda.
  }
}

function userFromToken(token: string, displayName?: string | null): SessionUser | null {
  const claims = decodeClaims(token);
  if (!claims?.sub || !claims.tenantId || !claims.tenantRole) return null;
  const username = claims.username ?? 'usuario';
  return { id: claims.sub, username, displayName: displayName || username, tenantId: claims.tenantId, role: claims.tenantRole };
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [tenants, setTenants] = useState<UserTenant[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [activeBranchId, setActiveBranchState] = useState<Uuid | null>(null);
  const [assignedBranchId, setAssignedBranchId] = useState<Uuid | null>(null);
  const bootstrapped = useRef(false);

  const loadContext = useCallback(async (sessionUser: SessionUser, assigned: Uuid | null) => {
    const [branchList, tenantList] = await Promise.all([
      branchesApi.list().catch(() => [] as Branch[]),
      authApi.tenants().catch(() => [] as UserTenant[]),
    ]);
    const activeBranches = branchList.filter((branch) => branch.status);
    setBranches(activeBranches);
    setTenants(tenantList);

    // El backend devuelve solo la sucursal asignada a quien opera acotado: se fija esa.
    const scoped = BRANCH_SCOPED_ROLES.includes(sessionUser.role) || (assigned !== null && activeBranches.length === 1);
    const lockedId = assigned ?? (scoped && activeBranches.length === 1 ? activeBranches[0]?.id ?? null : null);
    setAssignedBranchId(lockedId);

    const remembered = readPreference(BRANCH_PREFERENCE_KEY);
    const allowAll = can(sessionUser.role, 'dashboard.view') && !lockedId;
    const preferred =
      lockedId ??
      (remembered && activeBranches.some((branch) => branch.id === remembered) ? remembered : null) ??
      (allowAll ? null : activeBranches[0]?.id ?? null);
    setActiveBranchState(preferred);
  }, []);

  // Restaura la sesión al recargar: el access token no se persiste, se pide uno nuevo con la cookie HttpOnly.
  useEffect(() => {
    if (bootstrapped.current) return;
    bootstrapped.current = true;
    (async () => {
      const token = await refreshSession();
      const restored = token ? userFromToken(token, readPreference(NAME_PREFERENCE_KEY)) : null;
      if (!restored) {
        setStatus('anonymous');
        return;
      }
      setUser(restored);
      await loadContext(restored, null);
      setStatus('authenticated');
    })();
  }, [loadContext]);

  // Si la renovación falla en cualquier petición, la sesión se da por terminada.
  useEffect(
    () =>
      onSessionChange((token) => {
        if (token) return;
        setUser(null);
        setStatus((current) => (current === 'loading' ? current : 'anonymous'));
      }),
    [],
  );

  const login = useCallback(
    async (credentials: LoginRequest) => {
      const response: LoginResponse = await authApi.login(credentials);
      const person = response.user.person;
      const displayName = person ? `${person.firstName} ${person.lastName}`.trim() : response.user.username;
      const sessionUser = userFromToken(response.tokens.accessToken, displayName);
      if (!sessionUser) throw new Error('La respuesta del servidor no contiene una sesión válida.');
      sessionStore.set(response.tokens.accessToken);
      writePreference(NAME_PREFERENCE_KEY, displayName);
      setUser(sessionUser);
      await loadContext(sessionUser, response.user.branchId ?? null);
      setStatus('authenticated');
      const tenantList = await authApi.tenants().catch(() => [] as UserTenant[]);
      return { tenants: tenantList };
    },
    [loadContext],
  );

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch {
      // Aunque falle la red, la sesión local se descarta igual.
    }
    sessionStore.clear();
    writePreference(NAME_PREFERENCE_KEY, null);
    setUser(null);
    setBranches([]);
    setTenants([]);
    setStatus('anonymous');
  }, []);

  const setActiveBranchId = useCallback(
    (branchId: Uuid | null) => {
      if (assignedBranchId) return;
      setActiveBranchState(branchId);
      writePreference(BRANCH_PREFERENCE_KEY, branchId);
    },
    [assignedBranchId],
  );

  const reloadBranches = useCallback(async () => {
    const list = await branchesApi.list();
    setBranches(list.filter((branch) => branch.status));
  }, []);

  const value = useMemo<SessionContextValue>(() => {
    const tenant = tenants.find((item) => item.id === user?.tenantId) ?? null;
    return {
      status,
      user,
      tenant,
      tenants,
      branches,
      activeBranchId,
      activeBranch: branches.find((branch) => branch.id === activeBranchId) ?? null,
      branchLocked: Boolean(assignedBranchId),
      setActiveBranchId,
      login,
      logout,
      can: (capability: Capability) => can(user?.role, capability),
      reloadBranches,
    };
  }, [status, user, tenants, branches, activeBranchId, assignedBranchId, setActiveBranchId, login, logout, reloadBranches]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession debe usarse dentro de <SessionProvider>.');
  return context;
}

/** Nombre de una sucursal por id (para tablas que solo traen branchId). */
export function useBranchName(): (branchId: Uuid | null | undefined) => string {
  const { branches } = useSession();
  return useCallback(
    (branchId) => {
      if (!branchId) return '—';
      const branch = branches.find((item) => item.id === branchId);
      return branch ? branch.name : 'Sucursal';
    },
    [branches],
  );
}
