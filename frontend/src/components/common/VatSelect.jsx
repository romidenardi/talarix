import { VAT_OPTIONS, formatRate } from '../../utils/taxes.js';

const VatSelect = ({ id, registration, legacyValue }) => {
  const hasLegacy =
    legacyValue !== undefined &&
    legacyValue !== null &&
    legacyValue !== '' &&
    !VAT_OPTIONS.some((option) => Number(option.value) === Number(legacyValue));

  return (
    <>
      <select id={id} {...registration}>
        {VAT_OPTIONS.map((option) => (
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
