const moneyFormat = new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' });
const numberFormat = new Intl.NumberFormat('es-AR');

export const money = (n) => moneyFormat.format(Number(n) || 0);
export const int = (n) => numberFormat.format(Number(n) || 0);

const pad = (n) => String(n).padStart(2, '0');
export const toISODate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const presetRange = (preset, now = new Date()) => {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case 'thisMonth':
      return { from: toISODate(new Date(y, m, 1)), to: toISODate(now) };
    case 'lastMonth':
      return { from: toISODate(new Date(y, m - 1, 1)), to: toISODate(new Date(y, m, 0)) };
    case 'last30': {
      const from = new Date(now);
      from.setDate(from.getDate() - 29);
      return { from: toISODate(from), to: toISODate(now) };
    }
    case 'thisYear':
      return { from: toISODate(new Date(y, 0, 1)), to: toISODate(now) };
    default:
      return null;
  }
};

export const periodLabel = (period, groupBy) => {
  if (groupBy === 'month') {
    const [y, m] = period.split('-');
    return `${m}/${y}`;
  }
  const [, m, d] = period.split('-');
  return groupBy === 'week' ? `Sem. ${d}/${m}` : `${d}/${m}`;
};

export const formatDay = (key) => {
  if (!key) return '';
  const [y, m, d] = key.split('-');
  return `${d}/${m}/${y}`;
};

export const downloadCsv = (filename, headers, rows) => {
  const cell = (value) => {
    const text = typeof value === 'number' ? String(value).replace('.', ',') : (value ?? '');
    const s = String(text);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers, ...rows].map((row) => row.map(cell).join(';'));
  const blob = new Blob([`\uFEFF${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};
