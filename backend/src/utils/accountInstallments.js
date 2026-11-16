// Cálculos de las cuotas de la cuenta corriente de clientes, sin base de datos (los usa
// services/customerInstallment.service.js y se prueban en test/unit/accountInstallments.test.js).
//   - La primera cuota vence el próximo día elegido posterior a la venta (vendido el 10/11 con día
//     20: vence el 20/11; vendido el 20/11 o el 25/11: el 20/12). Las demás, un mes después de la
//     anterior. Si el mes no tiene ese día (31 en abril), vence el último día del mes.
//   - Las cuotas son iguales; los centavos que sobran van a la última.

const pad = (n) => String(n).padStart(2, '0');
const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate(); // month 1-12

// Fechas de vencimiento (AAAA-MM-DD) de count cuotas, para una venta del día saleKey
export const dueDates = (saleKey, dueDay, count) => {
  const [y, m, d] = saleKey.split('-').map(Number);
  let year = y;
  let month = m;
  // Si en el mes de la venta el día ya pasó (o es hoy), la primera vence el mes siguiente
  if (Math.min(dueDay, daysInMonth(year, month)) <= d) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  const dates = [];
  for (let i = 0; i < count; i += 1) {
    dates.push(`${year}-${pad(month)}-${pad(Math.min(dueDay, daysInMonth(year, month)))}`);
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return dates;
};

// Cuotas iguales en centavos; la última se lleva la diferencia
export const splitAmount = (total, count) => {
  const cents = Math.round(total * 100);
  const each = Math.floor(cents / count);
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? cents - each * (count - 1) : each) / 100);
};

// Días de atraso de una cuota impaga a la fecha today (AAAA-MM-DD); 0 si no venció
export const daysLate = (dueDate, today) => {
  const diff = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86400000;
  return diff > 0 ? Math.round(diff) : 0;
};
