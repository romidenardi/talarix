// Ayudas de la pantalla de Mesas

export const STATUS_LABELS = { open: 'Ocupada', billing: 'Pidió la cuenta', closed: 'Cobrada', cancelled: 'Anulada' };

export const formatQty = (quantity) => Number(quantity).toLocaleString('es-AR', { maximumFractionDigits: 3 });

export const lineTotal = (item) => Math.round(Number(item.quantity) * Number(item.unitPrice) * 100) / 100;

// Clase del renglón: los adicionales van sangrados debajo de su plato
export const itemClass = (item) =>
  [item.parentItemId && 'tab-item-extra', item.status === 'cancelled' && 'tab-item-cancelled']
    .filter(Boolean)
    .join(' ');

// Los renglones agrupados: cada plato con sus adicionales (vienen ordenados del servidor)
export const groupWithExtras = (items) => {
  const ids = new Set(items.map((i) => i.id));
  const groups = [];
  const byDish = new Map();
  for (const item of items) {
    if (item.parentItemId && ids.has(item.parentItemId)) {
      byDish.get(item.parentItemId)?.extras.push(item);
      continue;
    }
    const group = { item, extras: [] };
    byDish.set(item.id, group);
    groups.push(group);
  }
  return groups.map((g) => ({
    ...g,
    total: Math.round([g.item, ...g.extras].reduce((s, i) => s + lineTotal(i), 0) * 100) / 100,
  }));
};

export const sinceLabel = (date) => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(date).getTime()) / 60000));
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
};

export const timeLabel = (date) => new Date(date).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });

// Divide un total en n partes iguales en centavos; la última se lleva el resto
export const equalParts = (total, n) => {
  const cents = Math.round(total * 100);
  const base = Math.floor(cents / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? cents - base * (n - 1) : base) / 100);
};

// Con descuento, cada parte (por lo que pidió cada uno) baja en la misma proporción. Los centavos que
// sobran o faltan por redondeo van a la parte más grande, así la suma da justo el total.
export const scaleParts = (amounts, total) => {
  const gross = amounts.reduce((s, a) => s + a, 0);
  if (gross <= 0) return amounts.map(() => 0);
  const cents = amounts.map((a) => Math.round(((a * total) / gross) * 100));
  const diff = Math.round(total * 100) - cents.reduce((s, c) => s + c, 0);
  const biggest = cents.indexOf(Math.max(...cents));
  cents[biggest] += diff;
  return cents.map((c) => c / 100);
};

// Preferencia de este navegador: imprimir la comanda al mandarla
const PRINT_KEY = 'talarix.printTickets';
export const readPrintPref = () => {
  try {
    return localStorage.getItem(PRINT_KEY) === '1';
  } catch {
    return false;
  }
};
export const savePrintPref = (value) => {
  try {
    localStorage.setItem(PRINT_KEY, value ? '1' : '0');
  } catch {
    /* sin almacenamiento: no se recuerda */
  }
};

export const printTicket = (ticketId) => window.open(`/mesas/comandas/${ticketId}/imprimir`, '_blank');
