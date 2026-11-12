import { VAT_OPTIONS, formatRate } from '../../utils/taxes.js';

// options: las alícuotas para elegir (por defecto, las de los productos)
const VatSelect = ({ id, registration, legacyValue, options = VAT_OPTIONS }) => {
  const hasLegacy =
    legacyValue !== undefined &&
    legacyValue !== null &&
    legacyValue !== '' &&
    !options.some((option) => Number(option.value) === Number(legacyValue));

  return (
    <>
      <select id={id} {...registration}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        {hasLegacy && <option value={String(Number(legacyValue))}>{formatRate(legacyValue)} (valor anterior)</option>}
      </select>
      {hasLegacy && (
        <small style={{ color: 'var(--color-warning)', fontSize: 12 }}>
          Este producto tiene una alícuota que ya no está en la lista. Se mantiene hasta que elijas otra.
        </small>
      )}
    </>
  );
};

export default VatSelect;
