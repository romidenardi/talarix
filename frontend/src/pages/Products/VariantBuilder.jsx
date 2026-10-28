import { MAX_ATTRIBUTES, buildVariants } from '../../utils/variants.js';

export const EMPTY_VARIANT_ROWS = [
  { name: 'Talle', values: '' },
  { name: 'Color', values: '' },
];

// Atributos y valores de un producto nuevo con variantes. Muestra cuántas combinaciones se van a crear.
// value: [{ name, values }] (values: texto separado por comas)
export default function VariantBuilder({ value, onChange }) {
  const setRow = (index, field, text) => onChange(value.map((r, i) => (i === index ? { ...r, [field]: text } : r)));
  const preview = buildVariants(value);

  return (
    <div className="variant-builder">
      {value.map((row, index) => (
        <div className="variant-builder-row" key={index}>
          <div className="field">
            <label htmlFor={`variant-attr-${index}`}>Atributo {index + 1}</label>
            <input
              id={`variant-attr-${index}`}
              placeholder="Ej: Talle"
              value={row.name}
              onChange={(e) => setRow(index, 'name', e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor={`variant-values-${index}`}>Valores, separados por coma</label>
            <input
              id={`variant-values-${index}`}
              placeholder="Ej: S, M, L, XL"
              value={row.values}
              onChange={(e) => setRow(index, 'values', e.target.value)}
            />
          </div>
          {value.length > 1 && (
            <button type="button" onClick={() => onChange(value.filter((_, i) => i !== index))}>
              Quitar
            </button>
          )}
        </div>
      ))}
      {value.length < MAX_ATTRIBUTES && (
        <button type="button" onClick={() => onChange([...value, { name: '', values: '' }])}>
          Agregar atributo
        </button>
      )}
      <p className="report-note">
        {preview.error
          ? preview.error
          : `Se van a crear ${preview.items.length} ${preview.items.length === 1 ? 'variante' : 'variantes'}: ` +
            preview.items
              .slice(0, 6)
              .map((i) => i.values.join(' / '))
              .join(', ') +
            (preview.items.length > 6 ? ` y ${preview.items.length - 6} más` : '') +
            '. Los códigos de barras se cargan después, en cada variante.'}
      </p>
    </div>
  );
}
