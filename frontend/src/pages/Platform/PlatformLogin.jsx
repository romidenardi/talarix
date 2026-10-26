import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  platformLogin,
  platformLoginMfa,
  platformMfaSetup,
  platformMfaEnable,
  getPlatformToken,
  setPlatformToken,
} from '../../api/platform.api';

// Ingreso del superadmin en pasos:
//   password → code (código de la app o de recuperación) → /plataforma
//   password → setup (primera vez: QR y primer código) → recovery (códigos para guardar) → /plataforma
const errorMessage = (err, fallback) => err.response?.data?.message || fallback;

export default function PlatformLogin() {
  const navigate = useNavigate();
  const [step, setStep] = useState('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState('');
  const [code, setCode] = useState('');
  const [setup, setSetup] = useState(null); // { secret, qrDataUrl }
  const [recoveryCodes, setRecoveryCodes] = useState([]);
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  if (getPlatformToken() && step !== 'recovery' && step !== 'notice') return <Navigate to="/plataforma" replace />;

  const run = async (action, fallback) => {
    setError('');
    setLoading(true);
    try {
      await action();
    } catch (err) {
      setError(errorMessage(err, fallback));
      // El ingreso del paso 1 venció: hay que volver a empezar
      if (err.response?.status === 401 && step !== 'password') {
        setStep('password');
        setCode('');
        setPassword('');
      }
    } finally {
      setLoading(false);
    }
  };

  const handlePassword = (e) => {
    e.preventDefault();
    run(async () => {
      const { data } = await platformLogin({ email, password });
      setMfaToken(data.mfaToken);
      setCode('');
      if (data.mfaSetupRequired) {
        const { data: setupData } = await platformMfaSetup(data.mfaToken);
        setSetup(setupData);
        setStep('setup');
      } else {
        setStep('code');
      }
    }, 'No se pudo iniciar sesión');
  };

  const handleCode = (e) => {
    e.preventDefault();
    run(async () => {
      const { data } = await platformLoginMfa(mfaToken, code.trim());
      setPlatformToken(data.token);
      if (data.usedRecoveryCode) {
        setNotice(
          `Ingresaste con un código de recuperación. Te quedan ${data.recoveryCodesLeft}. ` +
            'Si perdiste el celular, desactivá y volvé a configurar el segundo factor (ver README del backend).',
        );
        setStep('notice');
      } else if (data.recoveryCodesLeft <= 3) {
        setNotice(
          `Te quedan ${data.recoveryCodesLeft} códigos de recuperación. Conviene generar códigos nuevos: ` +
            'desactivá y volvé a configurar el segundo factor (ver README del backend).',
        );
        setStep('notice');
      } else {
        navigate('/plataforma');
      }
    }, 'No se pudo verificar el código');
  };

  const handleEnable = (e) => {
    e.preventDefault();
    run(async () => {
      const { data } = await platformMfaEnable(mfaToken, code.trim());
      setPlatformToken(data.token);
      setRecoveryCodes(data.recoveryCodes || []);
      setStep('recovery');
    }, 'No se pudo activar el segundo factor');
  };

  const copyCodes = async () => {
    try {
      await navigator.clipboard.writeText(recoveryCodes.join('\n'));
    } catch {
      /* el navegador no deja copiar: se pueden seleccionar a mano */
    }
  };

  return (
    <div className="auth-page">
      {step === 'password' && (
        <form className="auth-card" onSubmit={handlePassword}>
          <h1>Administración de la plataforma</h1>
          <div className="field">
            <label htmlFor="platform-email">Email</label>
            <input
              id="platform-email"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="platform-password">Contraseña</label>
            <input
              id="platform-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" disabled={loading}>
            {loading ? 'Ingresando…' : 'Ingresar'}
          </button>
        </form>
      )}

      {step === 'code' && (
        <form className="auth-card" onSubmit={handleCode}>
          <h1>Código de verificación</h1>
          <p>Abrí Google Authenticator y escribí el código de 6 dígitos de Talarix.</p>
          <div className="field">
            <label htmlFor="platform-code">Código</label>
            <input
              id="platform-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          <p className="report-note">
            ¿No tenés el celular? Escribí uno de tus códigos de recuperación (por ejemplo ABCD-2345).
          </p>
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" disabled={loading || !code.trim()}>
            {loading ? 'Verificando…' : 'Verificar'}
          </button>
        </form>
      )}

      {step === 'setup' && setup && (
        <form className="auth-card" onSubmit={handleEnable}>
          <h1>Activá el segundo factor</h1>
          <p>
            Para entrar a la plataforma, además de la contraseña vas a usar un código de tu celular. Se configura una
            sola vez:
          </p>
          <ol>
            <li>
              En Google Authenticator tocá <strong>+</strong> → <strong>Escanear un código QR</strong>.
            </li>
            <li>Escaneá este código:</li>
          </ol>
          <img className="mfa-qr" src={setup.qrDataUrl} alt="Código QR para Google Authenticator" />
          <p className="report-note">
            Si no podés escanearlo, elegí <strong>Ingresar una clave de configuración</strong> y escribí:{' '}
            <code className="mfa-secret">{setup.secret}</code>
          </p>
          <div className="field">
            <label htmlFor="platform-setup-code">3. Escribí el código de 6 dígitos que muestra la app</label>
            <input
              id="platform-setup-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
          {error && <p className="auth-error">{error}</p>}
          <button type="submit" disabled={loading || !code.trim()}>
            {loading ? 'Activando…' : 'Activar'}
          </button>
        </form>
      )}

      {step === 'recovery' && (
        <div className="auth-card">
          <h1>Guardá tus códigos de recuperación</h1>
          <p>
            Si perdés el celular, cada uno de estos códigos te deja entrar <strong>una vez</strong> en lugar del código
            de la app. <strong>Se muestran solo ahora:</strong> guardalos en tu documento de claves.
          </p>
          <ul className="recovery-codes">
            {recoveryCodes.map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ul>
          <button type="button" onClick={copyCodes}>
            Copiar los códigos
          </button>
          <label className="recovery-confirm">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />
            Ya los guardé en un lugar seguro
          </label>
          <button type="button" disabled={!saved} onClick={() => navigate('/plataforma')}>
            Continuar
          </button>
        </div>
      )}

      {step === 'notice' && (
        <div className="auth-card">
          <h1>Ingresaste</h1>
          <p>{notice}</p>
          <button type="button" onClick={() => navigate('/plataforma')}>
            Continuar
          </button>
        </div>
      )}
    </div>
  );
}
