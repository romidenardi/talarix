import { useEffect, useState } from 'react';
import { getTermsStatus, acceptTerms } from '../../api/auth.api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { LEGAL_VERSION, LEGAL_EFFECTIVE_DATE } from '../../legal/legalContent';
import TermsCheckbox from './TermsCheckbox.jsx';

// Si el usuario no aceptó la versión vigente de los Términos y la Política (por ejemplo, porque se
// publicó una nueva), muestra este aviso en lugar del sistema hasta que la acepte. Si la consulta falla,
// deja pasar: el aviso vuelve a aparecer en el próximo ingreso.
export default function TermsGate({ children, skip = false }) {
  const { logout } = useAuth();
  const [status, setStatus] = useState('checking');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (skip) return;
    getTermsStatus()
      .then(({ data }) => setStatus(data.accepted ? 'ok' : 'pending'))
      .catch(() => setStatus('ok'));
  }, [skip]);

  const handleAccept = async (e) => {
    e.preventDefault();
    setError('');
    if (!accepted) return setError('Tenés que aceptar los Términos y Condiciones y la Política de Privacidad.');
    setSending(true);
    try {
      await acceptTerms(LEGAL_VERSION);
      setStatus('ok');
    } catch (err) {
      setError(err.response?.data?.message || 'No se pudo guardar la aceptación. Probá de nuevo.');
    } finally {
      setSending(false);
    }
    return undefined;
  };

  if (skip) return children;
  if (status === 'checking') return null;
  if (status === 'ok') return children;

  return (
    <div className="login-page terms-gate">
      <form onSubmit={handleAccept} noValidate>
        <h1>Actualizamos nuestros textos legales</h1>
        <p>
          Publicamos una nueva versión de los Términos y Condiciones y de la Política de Privacidad (versión{' '}
          {LEGAL_VERSION}, vigente desde el {LEGAL_EFFECTIVE_DATE}). Para seguir usando Talarix, leelos y aceptalos.
        </p>
        <TermsCheckbox checked={accepted} onChange={setAccepted} />
        {error && <p className="error">{error}</p>}
        <button type="submit" disabled={sending}>
          {sending ? 'Guardando…' : 'Aceptar y continuar'}
        </button>
        <button type="button" className="link-button" onClick={logout}>
          Cerrar sesión
        </button>
      </form>
    </div>
  );
}
