import * as XLSX from 'xlsx';
import { httpError } from './httpError.js';

// Tope de filas por archivo (sin contar el encabezado). Se lee como mucho una fila más, para saber
// si se pasó, así un archivo enorme no llena la memoria del servidor (que comparten todos los comercios).
export const MAX_IMPORT_ROWS = 5000;

const extensionOf = (name = '') => name.slice(name.lastIndexOf('.')).toLowerCase();

const startsWith = (buffer, bytes) => bytes.every((byte, i) => buffer[i] === byte);
const isZip = (buffer) => startsWith(buffer, [0x50, 0x4b, 0x03, 0x04]); // .xlsx
const isOle = (buffer) => startsWith(buffer, [0xd0, 0xcf, 0x11, 0xe0]); // .xls clásico
const isUtf16 = (buffer) => startsWith(buffer, [0xff, 0xfe]) || startsWith(buffer, [0xfe, 0xff]);
// .csv, o .xls exportado como HTML/XML: texto sin bytes nulos (salvo UTF-16, que los usa)
const looksLikeText = (buffer) => isUtf16(buffer) || !buffer.subarray(0, 4096).includes(0);

// El filtro de multer solo mira la extensión: acá se revisa que el contenido coincida
const contentMatches = (buffer, ext) => {
  if (ext === '.xlsx') return isZip(buffer);
  if (ext === '.xls') return isOle(buffer) || looksLikeText(buffer);
  if (ext === '.csv') return looksLikeText(buffer);
  return false;
};

export const parseSpreadsheet = (file) => {
  const buffer = file?.buffer;
  const ext = extensionOf(file?.originalname);

  if (!buffer || buffer.length === 0) throw httpError('El archivo está vacío');
  if (!contentMatches(buffer, ext)) {
    throw httpError('El contenido del archivo no corresponde a un Excel o CSV. Revisá que no esté dañado o renombrado.');
  }

  let workbook;
  try {
    workbook = XLSX.read(buffer, {
      type: 'buffer',
      sheetRows: MAX_IMPORT_ROWS + 2, // encabezado + el máximo + una para detectar el exceso
      cellFormula: false,
      cellHTML: false,
      cellStyles: false,
      // CSV: todo como texto. Si no, "1,500" (un kilo y medio, a la argentina) se leería como 1500.
      // Los números los interpreta después utils/importValues.js. No afecta a los .xlsx.
      raw: true,
    });
  } catch {
    throw httpError('No se pudo leer el archivo. Verificá que sea un Excel (.xlsx o .xls) o un CSV válido.');
  }

  const firstSheetName = workbook.SheetNames?.[0];
  if (!firstSheetName) throw httpError('El archivo no tiene hojas con datos');

  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[firstSheetName], { defval: '' });
  if (rows.length > MAX_IMPORT_ROWS) {
    throw httpError(
      `El archivo tiene más de ${MAX_IMPORT_ROWS.toLocaleString('es-AR')} filas. Dividilo en archivos más chicos e importalos de a uno.`
    );
  }
  return rows;
};
