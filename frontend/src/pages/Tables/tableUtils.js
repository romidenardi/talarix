// Ayudas de la pantalla de Mesas

export const STATUS_LABELS = { open: 'Ocupada', billing: 'Pidió la cuenta', closed: 'Cobrada', cancelled: 'Anulada' };

export const formatQty = (quantity) => Number(quantity).toLocaleString('es-AR', { maximumFractionDigits: 3 });

export const lineTotal = (item) => Math.round(Number(item.quantity) * Number(item.unitPrice) * 100) / 100;

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
