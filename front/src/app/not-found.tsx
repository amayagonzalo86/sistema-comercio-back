import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="d-flex align-items-center justify-content-center" style={{ minHeight: '100vh' }}>
      <div className="text-center">
        <div className="eyebrow">Error 404</div>
        <h1 className="h4 mt-2">No encontramos esa página</h1>
        <p className="text-muted-2 small">Puede que el enlace haya cambiado o que no tengas acceso.</p>
        <Link href="/" className="btn btn-primary btn-sm">
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}
