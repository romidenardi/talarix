import { httpError } from '../utils/httpError.js';

// Productos con variantes. Cada variante es un producto más (con su código, código de barras,
// stock y costo), así remitos, compras, stock, combos y reportes la tratan igual que a cualquier
// producto. El producto principal agrupa los datos comunes y no se vende, no se compra ni tiene stock.
//
//   principal: variantAttributes = ['Talle', 'Color']
//   variante:  parentId = principal.id, variantValues = ['M', 'Rojo'], name = 'Remera · M / Rojo'

export const MAX_ATTRIBUTES = 3;
export const MAX_VARIANTS = 100;
const MAX_NAME = 30;
const MAX_VALUE = 40;

export const isVariantGroup = (product) =>
  Array.isArray(product?.variantAttributes) && product.variantAttributes.length > 0;

export const isVariant = (product) => Boolean(product?.parentId);

export const variantName = (parentName, values) => `${parentName} · ${values.join(' / ')}`;

// Para comparar combinaciones sin importar mayúsculas ni espacios
export const valuesKey = (values) => values.map((v) => v.trim().toLowerCase()).join('\u0001');

// Lo que la variante toma siempre del principal
export const SHARED_FIELDS = ['categoryId', 'vatRate', 'otherTaxes', 'fiscalActivity', 'brand', 'model', 'description'];
// Lo que toma del principal mientras no tenga precio propio
export const PRICE_FIELDS = ['price', 'promoPrice'];

export const inheritedFields = (parent, { withPrice = true } = {}) => {
  const fields = withPrice ? [...SHARED_FIELDS, ...PRICE_FIELDS] : SHARED_FIELDS;
  return Object.fromEntries(fields.map((f) => [f, parent[f] ?? null]));
};

export const normalizeAttributes = (list) => {
  if (!Array.isArray(list) || list.length < 1 || list.length > MAX_ATTRIBUTES) {
    throw httpError(`Un producto puede tener de 1 a ${MAX_ATTRIBUTES} atributos (por ejemplo Talle y Color)`);
  }
  const names = list.map((name) => String(name ?? '').trim());
  if (names.some((name) => !name || name.length > MAX_NAME)) {
    throw httpError(`Cada atributo necesita un nombre de hasta ${MAX_NAME} caracteres`);
  }
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) {
    throw httpError('Hay dos atributos con el mismo nombre');
  }
  return names;
};

export const normalizeValues = (values, attributes) => {
  if (!Array.isArray(values) || values.length !== attributes.length) {
    throw httpError(`Cada variante necesita un valor para ${attributes.join(', ')}`);
  }
  return values.map((value, index) => {
    const text = String(value ?? '').trim();
    if (!text || text.length > MAX_VALUE) {
      throw httpError(`Falta el valor de ${attributes[index]} (hasta ${MAX_VALUE} caracteres)`);
    }
    return text;
  });
};

// Revisa una lista de combinaciones nuevas contra sí misma y contra las que ya existen
export const assertNewCombinations = (valuesList, existing = []) => {
  const seen = new Set(existing.map(valuesKey));
  for (const values of valuesList) {
    const key = valuesKey(values);
    if (seen.has(key)) throw httpError(`La variante ${values.join(' / ')} ya existe`, 409);
    seen.add(key);
  }
};

// Todas las combinaciones de los valores de cada atributo: [['S','M'],['Rojo']] → [['S','Rojo'],['M','Rojo']]
export const combinations = (valuesByAttribute) =>
  valuesByAttribute.reduce((acc, values) => acc.flatMap((combo) => values.map((v) => [...combo, v])), [[]]);
