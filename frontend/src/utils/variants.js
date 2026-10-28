// Productos con variantes (ver backend/src/services/variant.service.js). El producto principal
// agrupa los datos comunes y no se vende: en remitos, compras y combos se elige la variante.

export const MAX_ATTRIBUTES = 3;
export const MAX_VARIANTS = 100;

export const isVariantGroup = (product) =>
  Array.isArray(product?.variantAttributes) && product.variantAttributes.length > 0;

// "S, M , L,m" → ['S', 'M', 'L'] (sin vacíos ni repetidos, sin importar mayúsculas)
export const parseValues = (text) => {
  const seen = new Set();
  return String(text || '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => {
      const key = v.toLowerCase();
      if (!v || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

export const valuesKey = (values) => values.map((v) => String(v).trim().toLowerCase()).join('\u0001');

// [['S','M'],['Rojo']] → [['S','Rojo'],['M','Rojo']]
export const combinations = (valuesByAttribute) =>
  valuesByAttribute.reduce((acc, values) => acc.flatMap((combo) => values.map((v) => [...combo, v])), [[]]);

// Revisa los atributos que se cargan al crear el producto. Devuelve { error } o { attributes, items }.
export const buildVariants = (rows) => {
  const filled = rows.filter((r) => r.name.trim() || r.values.trim());
  if (!filled.length) return { error: 'Cargá al menos un atributo, por ejemplo Talle con S, M, L' };
  const names = filled.map((r) => r.name.trim());
  if (names.some((n) => !n)) return { error: 'Falta el nombre de un atributo (por ejemplo Talle o Color)' };
  if (new Set(names.map((n) => n.toLowerCase())).size !== names.length) {
    return { error: 'Hay dos atributos con el mismo nombre' };
  }
  const values = filled.map((r) => parseValues(r.values));
  const empty = values.findIndex((v) => !v.length);
  if (empty >= 0) return { error: `Escribí los valores de ${names[empty]}, separados por coma` };
  const items = combinations(values);
  if (items.length > MAX_VARIANTS) {
    return { error: `Son ${items.length} combinaciones: el máximo es ${MAX_VARIANTS}` };
  }
  return { attributes: names, items: items.map((v) => ({ values: v })) };
};
