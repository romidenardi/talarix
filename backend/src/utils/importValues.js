// Lectura de valores de las planillas de importación. Funciones puras (sin base de datos): se
// prueban en test/unit/importValues.test.js.

// Para comparar textos sin importar mayúsculas, tildes ni espacios de más: "Almacén " = "almacen"
export const normalizeText = (value) =>
  String(value ?? '')
    .replace(/[\uFEFF\u200B]/g, '') // BOM y espacios invisibles que dejan algunos CSV
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

export const text = (value) => String(value ?? '').trim();

// Una fila sin ningún dato (Excel suele traer filas "vacías" al final)
export const isEmptyRow = (row) => Object.values(row || {}).every((v) => text(v) === '');

// Importes escritos a la argentina o a la inglesa. Devuelve null si está vacío y NaN si no se entiende.
//   1234,50 · 1.234,50 · $ 1.234,50 · 1234.50 · 1,234.50 · 1.234 (= mil doscientos treinta y cuatro)
export const parseAmount = (value) => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
  let s = text(value).replace(/\$|\s/g, '');
  if (s === '') return null;
  if (!/^-?[\d.,]+$/.test(s)) return NaN;

  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    // Los dos: el que aparece último es el decimal
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma !== -1) {
    // Solo comas: una sola es decimal (1234,50); varias son miles (1,234,567)
    s = s.match(/,/g).length === 1 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (lastDot !== -1) {
    // Solo puntos: varios son miles (1.234.567); uno seguido de exactamente 3 cifras también
    // (1.234 = 1234, como se escribe en Argentina), salvo que empiece con 0 (0.250)
    const dots = s.match(/\./g).length;
    const [intPart, decPart] = s.split('.');
    if (dots > 1 || (decPart.length === 3 && intPart.replace('-', '') !== '0')) s = s.replace(/\./g, '');
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
};

// Columna Unidad: null = no se entiende
const WEIGHT_WORDS = [
  'peso',
  'kg',
  'kgs',
  'kilo',
  'kilos',
  'kilogramo',
  'kilogramos',
  'granel',
  'a granel',
  'por kg',
  'x kg',
  'por peso',
];
const UNIT_WORDS = ['', 'unidad', 'unidades', 'u', 'un', 'und', 'unid', 'c/u', 'por unidad', 'x unidad'];
export const parseUnit = (value) => {
  const v = normalizeText(value).replace(/\.$/, '');
  if (WEIGHT_WORDS.includes(v)) return 'weight';
  if (UNIT_WORDS.includes(v)) return 'unit';
  return null;
};

// Columna IVA: 21, 10,5, "21%", 0, "exento", o 0,21 / 0,105 (celdas con formato porcentaje).
// Vacía = 21. Devuelve NaN si no es una de las alícuotas permitidas.
export const ALLOWED_VAT_RATES = [0, 10.5, 21];
export const parseVat = (value) => {
  const raw = normalizeText(value).replace('%', '').trim();
  if (raw === '') return 21;
  if (['exento', 'exenta', 'no gravado', 'no gravada'].includes(raw)) return 0;
  let n = parseAmount(raw);
  if (Number.isNaN(n) || n === null) return NaN;
  if (n > 0 && n < 1) n = Math.round(n * 1000) / 10; // 0,21 → 21 · 0,105 → 10,5
  return ALLOWED_VAT_RATES.includes(n) ? n : NaN;
};

// Impuestos internos (%): vacío = null; NaN si no es un porcentaje válido
export const parsePercent = (value) => {
  const raw = normalizeText(value).replace('%', '').trim();
  if (raw === '') return null;
  let n = parseAmount(raw);
  if (n === null || Number.isNaN(n)) return NaN;
  if (n > 0 && n < 1 && /^0[.,]/.test(raw)) n = Math.round(n * 10000) / 100;
  return n >= 0 && n <= 100 ? n : NaN;
};

// Condición fiscal: los cuatro valores que usa el sistema, aceptando abreviaturas y variantes
export const FISCAL_CONDITIONS = ['Consumidor Final', 'Responsable Inscripto', 'Monotributista', 'Exento'];
const FISCAL_ALIASES = {
  'consumidor final': 'Consumidor Final',
  cf: 'Consumidor Final',
  'cons. final': 'Consumidor Final',
  final: 'Consumidor Final',
  'responsable inscripto': 'Responsable Inscripto',
  'responsable inscripta': 'Responsable Inscripto',
  ri: 'Responsable Inscripto',
  'resp. inscripto': 'Responsable Inscripto',
  'iva responsable inscripto': 'Responsable Inscripto',
  monotributista: 'Monotributista',
  monotributo: 'Monotributista',
  mono: 'Monotributista',
  'responsable monotributo': 'Monotributista',
  mt: 'Monotributista',
  exento: 'Exento',
  exenta: 'Exento',
  'iva exento': 'Exento',
  ex: 'Exento',
};
export const normalizeFiscalCondition = (value) => FISCAL_ALIASES[normalizeText(value)] ?? null;

// Máximo de las columnas de texto de la base (VARCHAR 255)
export const MAX_TEXT = 255;
