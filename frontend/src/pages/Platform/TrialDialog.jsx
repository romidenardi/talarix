import { useEffect, useState } from 'react';
import { toISODate } from '../../utils/reportFormat.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DAYS = 3 * 366;

// Renovar la prueba de un comercio: hasta una fecha (vence al terminar ese día) o sin vencimiento.
// onClose(null) si cancela; onClose({ until: 'AAAA-MM-DD' | null }) si confirma.
export default function TrialDialog({ business, saving = false, onClose }) {
  const today = toISODate(new Date());
  const current = business.trialEndsAt ? new Date(business.trialEndsAt) : null;
  // Propuesta: 30 días más desde el vencimiento actual (o desde hoy, si ya venció)
  const base = current && current > new Date() ? current : new Date();
  const [mode, setMode] = useState('date');
  const [until, setUntil] = useState(toISODate(new Date(base.getTime() + 30 * DAY_MS)));
  const [error, setError] = useState('');
  const maxDate = toISODate(new Date(Date.now() + MAX_DAYS * DAY_MS));

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !saving) onClose(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const submit = (e) => {
    e.preventDefault();
    if (mode === 'none') return onClose({ until: null });
    if (!until) return setError('Elegí la fecha');
    if (until < today) return setError('La fecha no puede ser anterior a hoy');
    if (until > maxDate) return setError('La fecha puede ser hasta dentro de 3 años');
    return onClose({ until });
  };

  const expired = business.suspendedReason === 'trial_expired';

  return (
    <div className="dialog-overlay">
      <form className="dialog-box" role="dialog" aria-modal="true" aria-labelledby="trial-title" onSubmit={submit}>
        <h3 id="trial-title">Renovar prueba · {business.name}</h3>
        <p className="dialog-message">
          {current
            ? `${expired ? 'Venció' : 'Vence'} el ${current.toLocaleDateString('es-AR')}.`
            : 'Hoy no tiene vencimiento.'}
          {expired && ' Al renovar, el comercio se reactiva.'}
        </p>

        <label className="trial-option">
          <input type="radio" name="trial-mode" checked={mode === 'date'} onChange={() => setMode('date')} />
          Hasta el
          <input
            type="date"
            value={until}
            min={today}
            max={maxDate}
            disabled={mode !== 'date'}
            onChange={(e) => {
              setUntil(e.target.value);
              setError('');
            }}
          />
        </label>
        <label className="trial-option">
          <input type="radio" name="trial-mode" checked={mode === 'none'} onChange={() => setMode('none')} />
          Sin vencimiento
        </label>
        {error && <span className="error">{error}</span>}

        <div className="dialog-actions">
          <button type="button" disabled={saving} onClick={() => onClose(null)}>
            Cancelar
          </button>
          <button type="submit" disabled={saving}>
            {saving ? 'Guardando…' : 'Renovar'}
          </button>
        </div>
      </form>
    </div>
  );
}
