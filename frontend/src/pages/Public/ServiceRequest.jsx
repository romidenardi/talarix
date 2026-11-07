import { useState } from 'react';
import { Link } from 'react-router-dom';
import { sendServiceRequest } from '../../api/public.api.js';

// Textos de cada botón: baja (Res. 316/2018) y arrepentimiento (Res. 424/2020, art. 34 Ley 24.240)
const COPY = {
  cancellation: {
    title: 'Botón de baja',
    intro:
      'Pedí la baja de tu cuenta de Talarix. No tiene costo y no hace falta dar explicaciones. ' +
      'Al enviarla te llega a tu email un código de la solicitud.',
    submit: 'Pedir la baja',
    done:
      'Te vamos a escribir para confirmar la baja. Desde ese momento, el administrador de la cuenta tiene ' +
      '30 días para descargar los datos; después se eliminan.',
  },
  withdrawal: {
    title: 'Botón de arrepentimiento',
    intro:
      'Si contrataste un Plan Pago de Talarix, podés arrepentirte dentro de los 10 días corridos desde la ' +
      'contratación (artículo 34 de la Ley 24.240). Te devolvemos la totalidad de lo abonado.',
    submit: 'Arrepentirme de la contratación',
    done: 'Te vamos a escribir para coordinar la devolución de lo abonado.',
  },
};

const EMPTY = { name: '', email: '', businessName: '', reason: '', website: '' };

export default function ServiceRequest({ kind }) {
  const copy = COPY[kind];
  const [form, setForm] = useState(EMPTY);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState(null);

  const field = (name) => ({
    id: `sr-${name}`,
    value: form[name],
    onChange: (e) => setForm({ ...form, [name]: e.target.value }),
  });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.name.trim()) return setError('Escribí tu nombre');
    if (!form.email.trim()) return setError('Escribí tu email');

    setSending(true);
    try {
      const { data } = await sendServiceRequest({ ...form, kind });
      setResult({ ...data, email: form.email.trim() });
    } catch (err) {
      setError(err.response?.data?.message || 'No se pudo enviar la solicitud. Probá de nuevo.');
    } finally {
      setSending(false);
    }
    return undefined;
  };

  return (
    <div className="login-page service-request-page">
      <form onSubmit={handleSubmit} noValidate>
        <h1>{copy.title}</h1>

        {result ? (
          <>
            <p>Recibimos tu solicitud.</p>
            <p className="service-request-code">
              Código de la solicitud: <strong>{result.code}</strong>
            </p>
            <p>
              {result.emailSent
                ? `Te lo enviamos a ${result.email} (revisá también la carpeta de spam).`
                : 'No pudimos enviarte el mail: anotá este código para cualquier consulta.'}
            </p>
            <p>{copy.done}</p>
          </>
        ) : (
          <>
            <p>{copy.intro}</p>

            <label htmlFor="sr-name">Nombre y apellido</label>
            <input autoComplete="name" maxLength={255} {...field('name')} />

            <label htmlFor="sr-email">Email</label>
            <input type="email" autoComplete="email" maxLength={255} {...field('email')} />
            <small>Usá el email con el que ingresás a Talarix: así ubicamos tu cuenta.</small>

            <label htmlFor="sr-businessName">Comercio (opcional)</label>
            <input autoComplete="organization" maxLength={255} {...field('businessName')} />

            {kind === 'cancellation' && (
              <>
                <label htmlFor="sr-reason">Motivo (opcional)</label>
                <textarea rows={3} maxLength={2000} {...field('reason')} />
              </>
            )}

            {/* Campo trampa para robots: oculto, una persona no lo ve ni lo completa */}
            <div className="hp-field" aria-hidden="true">
              <label htmlFor="sr-website">No completar</label>
              <input tabIndex={-1} autoComplete="off" {...field('website')} />
            </div>

            {error && <p className="error">{error}</p>}
            <button type="submit" disabled={sending}>
              {sending ? 'Enviando…' : copy.submit}
            </button>
          </>
        )}

        <p className="public-links">
          <Link to="/terminos">Términos</Link> · <Link to="/privacidad">Privacidad</Link> ·{' '}
          <Link to="/login">Ingresar</Link>
        </p>
      </form>
    </div>
  );
}
