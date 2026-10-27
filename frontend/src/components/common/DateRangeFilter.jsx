import { useState } from 'react';
import { presetRange } from '../../utils/reportFormat.js';

const PRESETS = [
  ['last30', 'Últimos 30 días'],
  ['thisMonth', 'Este mes'],
  ['lastMonth', 'Mes anterior'],
  ['thisYear', 'Este año'],
];

// Elegir qué período mostrar en una lista (Remitos, Compras): así no se cargan todos los de la
// historia. El servidor acepta hasta un año por consulta.
export default function DateRangeFilter({ value, onChange, loading = false, label = 'Mostrar' }) {
  const [from, setFrom] = useState(value.from);
  const [to, setTo] = useState(value.to);
  const [error, setError] = useState('');

  const apply = (range) => {
    if (!range.from || !range.to) return setError('Elegí las dos fechas');
    if (range.from > range.to) return setError('La fecha "desde" no puede ser posterior a "hasta"');
    setError('');
    setFrom(range.from);
    setTo(range.to);
    onChange(range);
    return undefined;
  };

  return (
    <div className="date-range-filter">
      <span className="date-range-label">{label}:</span>
      <div className="date-range-presets">
        {PRESETS.map(([key, text]) => (
          <button key={key} type="button" disabled={loading} onClick={() => apply(presetRange(key))}>
            {text}
          </button>
        ))}
      </div>
      <div className="date-range-custom">
        <label>
          Desde <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          Hasta <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <button type="button" disabled={loading} onClick={() => apply({ from, to })}>
          {loading ? 'Cargando…' : 'Ver'}
        </button>
      </div>
      {error && <span className="error">{error}</span>}
    </div>
  );
}
