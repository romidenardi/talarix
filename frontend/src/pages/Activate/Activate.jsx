import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useUrlToken } from '../../hooks/useUrlToken.js';
import api from '../../api/axios';
import { LEGAL_VERSION } from '../../legal/legalContent';
import { passwordProblem } from '../../utils/password.js';

export default function Activate() {
  const navigate = useNavigate();
  const token = useUrlToken();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirm) return setError('Las contraseñas no coinciden');
    if (!accepted) return setError('Tenés que aceptar los Términos y Condiciones y el Aviso de Privacidad');

    setLoading(true);
    try {
      await api.post('/auth/activate', {
        token,
        password,
        acceptTerms: true,
        legalVersion: LEGAL_VERSION,
      });
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err.response?.data?.message || 'No se pudo activar la cuenta');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Link inválido</h1>
          <p>El link de activación está incompleto. Pedí uno nuevo.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Activá tu cuenta</h1>
        {done ? (
          <p>Contraseña creada. Te llevamos al inicio de sesión…</p>
        ) : (
          <>
            <p>Elegí la contraseña con la que vas a ingresar.</p>
            <div className="field">
              <label htmlFor="password">Contraseña</label>
              <input id="password" type="password" autoComplete="new-password"
                value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="confirm">Repetir contraseña</label>
              <input id="confirm" type="password" autoComplete="new-password"
                value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            </div>

            <label className="terms-check">
              <input type="checkbox" checked={accepted}
                onChange={(e) => setAccepted(e.target.checked)} />
              <span>
                Leí y acepto los{' '}
                <Link to="/terminos" target="_blank" rel="noopener noreferrer">Términos y Condiciones de la beta</Link>
                {' '}y el{' '}
                <Link to="/privacidad" target="_blank" rel="noopener noreferrer">Aviso de Privacidad</Link>.
                Entiendo que durante la beta no hay copias de seguridad garantizadas y que mis datos
                pueden almacenarse en servidores fuera de Argentina.
              </span>
            </label>

            {error && <p className="auth-error">{error}</p>}
            <button type="submit" disabled={loading}>
              {loading ? 'Guardando…' : 'Crear contraseña'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}