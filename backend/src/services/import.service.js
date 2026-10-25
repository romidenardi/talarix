import { sequelize } from '../models/index.js';
import { isEmptyRow, MAX_TEXT } from '../utils/importValues.js';

// Importación en dos pasos: primero se revisan TODAS las filas y, solo si ninguna tiene errores, se
// guardan todas juntas en una transacción. O entra todo o no entra nada: así un archivo con una
// fila mal no deja el catálogo a medio cargar, y se puede corregir y volver a subir el mismo archivo.
//
// Las filas que ya existen (mismo código interno, mismo CUIT…) no se duplican: se saltean y se
// informan. Por eso subir dos veces el mismo archivo no duplica nada.
//
// Opciones:
//   rows          filas de la planilla (parseSpreadsheet)
//   mapRow(raw)   → datos de la fila (puede tirar un Error con un mensaje para el usuario)
//   validate(d)   → mensaje de error o null
//   textFields    [['campo', 'nombre para el usuario'], …] que no pueden pasar de 255 caracteres
//   keys          claves que no se pueden repetir. Cada una:
//                   of(d)          → valor de la clave (o null si la fila no la tiene)
//                   show(d)        → cómo mostrarla en los mensajes
//                   existing       → Map(valor → nombre de lo que ya existe en el comercio)
//                   onExisting     'skip' (se saltea) o 'error' (frena la importación)
//                   inFile         'skip' o 'error' si se repite dentro del mismo archivo
//                   existsMessage(d, nombre), repeatMessage(d, fila)
//   create(items, transaction) → { notes } guarda las filas válidas ([{ row, data }])
//
// Resultado: { imported, created, skipped: [{ row, message }], errors: [{ row, message }], notes: [] }
export const runImport = async ({ rows, mapRow, validate, textFields = [], keys = [], create }) => {
  const result = { imported: false, created: 0, skipped: [], errors: [], notes: [] };
  const seen = keys.map(() => new Map());
  const items = [];

  rows.forEach((raw, index) => {
    const row = index + 2; // la fila 1 es el encabezado
    if (isEmptyRow(raw)) return;

    let data;
    try {
      data = mapRow(raw);
    } catch (error) {
      result.errors.push({ row, message: error.message });
      return;
    }

    const tooLong = textFields.find(([field]) => String(data[field] ?? '').length > MAX_TEXT);
    if (tooLong) {
      result.errors.push({ row, message: `${tooLong[1]} es demasiado largo (máximo ${MAX_TEXT} caracteres)` });
      return;
    }

    const invalid = validate(data);
    if (invalid) {
      result.errors.push({ row, message: invalid });
      return;
    }

    for (const [i, key] of keys.entries()) {
      const value = key.of(data);
      if (value === null || value === undefined || value === '') continue;

      const firstRow = seen[i].get(value);
      if (firstRow) {
        const target = key.inFile === 'skip' ? result.skipped : result.errors;
        target.push({ row, message: key.repeatMessage(data, firstRow) });
        return;
      }
      seen[i].set(value, row);

      if (key.existing.has(value)) {
        const target = key.onExisting === 'skip' ? result.skipped : result.errors;
        target.push({ row, message: key.existsMessage(data, key.existing.get(value)) });
        return;
      }
    }

    items.push({ row, data });
  });

  // Con un solo error no se guarda nada
  if (result.errors.length) return result;

  if (items.length) {
    const t = await sequelize.transaction();
    try {
      const extra = await create(items, t);
      await t.commit();
      result.notes = extra?.notes || [];
    } catch (error) {
      await t.rollback();
      throw error;
    }
  }

  result.created = items.length;
  result.imported = true;
  return result;
};
