import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useUrlToken } from '../../hooks/useUrlToken.js';
import { resetPassword } from '../../api/auth.api.js';
import { passwordProblem } from '../../utils/password.js';

export default function ResetPassword() {
  const navigate = useNavigate();
  const token = useUrlToken();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    const problem = passwordProblem(password);
    if (problem) return setError(problem);
    if (password !== confirm) return setError('Las contraseñas no coinciden');

    setLoading(true);
    try {
      await resetPassword(token, password);
      setDone(true);
      setTimeout(() => navigate('/login'), 2500);
    } catch (err) {
      setError(err.response?.data?.message || 'No se pudo cambiar la contraseña');
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="auth-page">
        <div className="auth-card">
          <h1>Link inválido</h1>
          <p>El link está incompleto. Pedí uno nuevo.</p>
          <p><Link to="/olvide-contrasena">Pedir un link nuevo</Link></p>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Elegí tu nueva contraseña</h1>

        {done ? (
          <p>Contraseña actualizada. Te llevamos al inicio de sesión…</p>
        ) : (
          <>
            <div className="field">
              <label htmlFor="password">Nueva contraseña</label>
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="confirm">Repetir contraseña</label>
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>

            {error && <p className="auth-error">{error}</p>}
            <button type="submit" disabled={loading}>
              {loading ? 'Guardando…' : 'Guardar contraseña'}
            </button>
            <p><Link to="/olvide-contrasena">¿El link venció? Pedí uno nuevo</Link></p>
          </>
        )}
      </form>
    </div>
  );
}