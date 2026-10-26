import { useState } from 'react';
import { Link } from 'react-router-dom';
import { forgotPassword } from '../../api/auth.api.js';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) return setError('Ingresá tu email');

    setLoading(true);
    try {
      await forgotPassword(email.trim());
      setDone(true);
    } catch (err) {
      setError(err.response?.data?.message || 'No se pudo enviar el pedido. Probá de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleSubmit}>
        <h1>Recuperar contraseña</h1>

        {done ? (
          <>
            <p>
              Si el email corresponde a una cuenta activa, te enviaremos un link para continuar. Revisá tu bandeja de
              entrada y la carpeta de spam. El link será valido por una hora.
            </p>
            <p>
              <Link to="/login">Volver a iniciar sesión</Link>
            </p>
          </>
        ) : (
          <>
            <p>Ingresá tu email y te enviaremos un link para elegir una contraseña nueva.</p>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            {error && <p className="auth-error">{error}</p>}
            <button type="submit" disabled={loading}>
              {loading ? 'Enviando…' : 'Enviar link'}
            </button>
            <p>
              <Link to="/login">Volver a iniciar sesión</Link>
            </p>
          </>
        )}
      </form>
    </div>
  );
}
