'use client';

import { useEffect, useState } from 'react';
import { isStrongPassword, PasswordField } from '@/components/forms/PasswordField';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { errorMessage } from '@/lib/api/client';
import { authApi } from '@/lib/api/endpoints';

/** Cambio de la contraseña propia: pide la actual y cierra las demás sesiones abiertas del usuario. */
export function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setCurrent('');
      setNext('');
      setConfirm('');
      setError(null);
    }
  }, [open]);

  const mismatch = confirm.length > 0 && confirm !== next;
  const valid = current.length > 0 && isStrongPassword(next) && next === confirm && next !== current;

  const submit = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.changePassword(current, next);
      toast.success('Contraseña actualizada', result.message);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      busy={busy}
      size="sm"
      title="Cambiar mi contraseña"
      subtitle="Se cerrará tu sesión en los demás dispositivos."
      footer={
        <>
          <button type="button" className="btn btn-light" onClick={onClose} disabled={busy}>
            Cancelar
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !valid}>
            {busy && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}
            Guardar contraseña
          </button>
        </>
      }
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
        className="d-flex flex-column gap-3"
      >
        <PasswordField label="Contraseña actual" value={current} onChange={setCurrent} autoComplete="current-password" autoFocus />
        <PasswordField label="Contraseña nueva" value={next} onChange={setNext} withRules />
        <div>
          <PasswordField label="Repetí la contraseña nueva" value={confirm} onChange={setConfirm} />
          {mismatch && <div className="small text-danger mt-1">Las contraseñas no coinciden.</div>}
          {next && current && next === current && <div className="small text-danger mt-1">Tiene que ser distinta de la actual.</div>}
        </div>
        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
      {error && <div className="alert alert-danger small py-2 mt-3 mb-0">{error}</div>}
    </Modal>
  );
}
