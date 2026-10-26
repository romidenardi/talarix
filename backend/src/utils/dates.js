import { httpError } from './httpError.js';

// Fechas de los reportes, siempre en hora argentina (UTC-3 fijo; Argentina no tiene horario de verano).
// dayKey(fecha) → 'AAAA-MM-DD' del día argentino: un remito de las 23:30 del 31 cuenta el 31.

export const DAY_MS = 24 * 60 * 60 * 1000;
export const MAX_RANGE_DAYS = 366;
export const TZ_OFFSET_MS = 3 * 60 * 60 * 1000;
export const KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const dayKey = (date) => new Date(date.getTime() - TZ_OFFSET_MS).toISOString().slice(0, 10);
export const startOfDay = (key) => new Date(`${key}T00:00:00-03:00`);
export const addDays = (key, n) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const mondayOf = (key) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
};
export const periodKey = (date, groupBy) => {
  const key = dayKey(date);
  if (groupBy === 'week') return mondayOf(key);
  if (groupBy === 'month') return key.slice(0, 7);
  return key;
};

export const readRange = (query) => {
  const to = query.to || dayKey(new Date());
  const from = query.from || addDays(to, -29);
  if (!KEY_RE.test(from) || !KEY_RE.test(to)) {
    throw httpError('Las fechas deben tener el formato AAAA-MM-DD');
  }
  const start = startOfDay(from);
  const lastDay = startOfDay(to);
  if (Number.isNaN(start.getTime()) || Number.isNaN(lastDay.getTime())) {
    throw httpError('Fecha inválida');
  }
  const end = startOfDay(addDays(to, 1));
  if (end <= start) throw httpError('La fecha "hasta" no puede ser anterior a "desde"');
  if ((end - start) / DAY_MS > MAX_RANGE_DAYS) {
    throw httpError(`El rango máximo es de ${MAX_RANGE_DAYS} días`);
  }
  return { from, to, start, end };
};
