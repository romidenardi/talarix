import { useEffect, useState } from 'react';
import { getScaleConfig, updateScaleConfig } from '../../api/scale.api.js';
import FormMessage from '../../components/common/FormMessage.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { serverMessage } from '../../utils/serverErrors.js';
import { useAuth } from '../../context/AuthContext.jsx';
import Spinner from '../../components/common/Spinner.jsx';
import { DEFAULT_SCALE_CONFIG, resolveScaleConfig, parseScaleCode, lineFromLabel } from '../../utils/scale.js';
import { formatQuantity } from '../../utils/quantity.js';

const money = (value) => `$${(Number(value) || 0).toFixed(2)}`;

const ScaleSettings = ({ products }) => {
  const msg = useMessage();
  const { role } = useAuth();
  const canEdit = role === 'admin' || role === 'editor';

  const [form, setForm] = useState(DEFAULT_SCALE_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testCode, setTestCode] = useState('');

  useEffect(() => {
    getScaleConfig()
      .then(({ data }) => setForm(resolveScaleConfig(data)))
      .catch(() => msg.error('No se pudo cargar la configuración de la balanza. Recargá la página.'))
      .finally(() => setLoading(false));
  }, []);

  const set = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const changeValueType = (valueType) => {
    setForm((prev) => ({ ...prev, valueType, decimals: valueType === 'quantity' ? 3 : 2 }));
  };

  const useSystelDefaults = () => {
    setForm((prev) => ({
      ...DEFAULT_SCALE_CONFIG,
      enabled: prev.enabled,
      valueType: prev.valueType,
      decimals: prev.valueType === 'quantity' ? 3 : 2,
    }));
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const { data } = await updateScaleConfig({
        ...form,
        pluStart: Number(form.pluStart),
        pluLength: Number(form.pluLength),
        valueStart: Number(form.valueStart),
        valueLength: Number(form.valueLength),
        decimals: Number(form.decimals),
      });
      setForm(resolveScaleConfig(data));
      msg.success('Configuración de la balanza guardada');
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo guardar la configuración'));
    } finally {
      setSaving(false);
    }
  };

  const testConfig = {
    ...form,
    enabled: true,
    pluStart: Number(form.pluStart),
    pluLength: Number(form.pluLength),
    valueStart: Number(form.valueStart),
    valueLength: Number(form.valueLength),
    decimals: Number(form.decimals),
  };
  const trimmed = testCode.trim();
  const parsed = trimmed ? parseScaleCode(trimmed, testConfig) : null;
  const matched = parsed ? products.find((p) => !p.isCombo && p.scalePlu === parsed.plu) : null;
  const line = parsed && matched ? lineFromLabel(parsed, matched) : null;

  const productsWithPlu = products.filter((p) => !p.isCombo && p.scalePlu).sort((a, b) => a.scalePlu - b.scalePlu);

  if (loading) return <Spinner label="Cargando configuración..." />;

  return (
    <>
      <p className="report-note">
        Si tenés una balanza que imprime etiquetas con código de barras (por ejemplo Systel), el sistema puede leerlas
        en los remitos: el código trae el PLU del producto y el peso o el importe. Para cada producto por peso, cargá el
        PLU que tiene en la balanza (pestaña Productos, campo "PLU de balanza").
      </p>
      <p className="report-note">
        En la balanza Systel el tipo de dato se elige en{' '}
        <strong>MENÚ → Configuración (tres veces) → Clave → EAN13</strong>: <strong>CANTID</strong> imprime el peso y{' '}
        <strong>TOTAL</strong> imprime el importe. Vale para todos los artículos y no está disponible en todos los
        modelos.
      </p>

      <form onSubmit={save} className="product-form">
        <fieldset disabled={!canEdit} style={{ border: 'none', padding: 0, margin: 0, display: 'contents' }}>
          <div className="field field-full">
            <label htmlFor="scale-enabled">
              <input
                id="scale-enabled"
                type="checkbox"
                checked={form.enabled}
                onChange={(e) => set('enabled', e.target.checked)}
              />{' '}
              Leer etiquetas de balanza en los remitos
            </label>
          </div>

          <div className="field">
            <label htmlFor="scale-valueType">La etiqueta trae</label>
            <select id="scale-valueType" value={form.valueType} onChange={(e) => changeValueType(e.target.value)}>
              <option value="quantity">El peso (CANTID)</option>
              <option value="amount">El importe (TOTAL)</option>
            </select>
          </div>

          <div className="field">
            <label htmlFor="scale-prefix">Prefijo</label>
            <input
              id="scale-prefix"
              value={form.prefix}
              onChange={(e) => set('prefix', e.target.value.replace(/\D/g, ''))}
              maxLength={4}
            />
          </div>

          <div className="field">
            <label htmlFor="scale-pluStart">PLU: desde el dígito</label>
            <input
              id="scale-pluStart"
              type="number"
              min="1"
              max="13"
              value={form.pluStart}
              onChange={(e) => set('pluStart', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="scale-pluLength">PLU: cantidad de dígitos</label>
            <input
              id="scale-pluLength"
              type="number"
              min="1"
              max="6"
              value={form.pluLength}
              onChange={(e) => set('pluLength', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="scale-valueStart">Valor: desde el dígito</label>
            <input
              id="scale-valueStart"
              type="number"
              min="1"
              max="13"
              value={form.valueStart}
              onChange={(e) => set('valueStart', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="scale-valueLength">Valor: cantidad de dígitos</label>
            <input
              id="scale-valueLength"
              type="number"
              min="1"
              max="8"
              value={form.valueLength}
              onChange={(e) => set('valueLength', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="scale-decimals">Decimales del valor</label>
            <input
              id="scale-decimals"
              type="number"
              min="0"
              max="4"
              value={form.decimals}
              onChange={(e) => set('decimals', e.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor="scale-checkDigit">
              <input
                id="scale-checkDigit"
                type="checkbox"
                checked={form.checkDigit}
                onChange={(e) => set('checkDigit', e.target.checked)}
              />{' '}
              Verificar el dígito de control
            </label>
          </div>
        </fieldset>

        {canEdit && (
          <div className="inline-edit-actions">
            <button type="submit" disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
            <button type="button" onClick={useSystelDefaults}>
              Usar valores de Systel
            </button>
          </div>
        )}
        <FormMessage message={msg.message} onClose={msg.clear} />
        {!canEdit && <p className="report-note">Solo un administrador o editor puede cambiar esta configuración.</p>}
      </form>

      <h3>Probar una etiqueta</h3>
      <div className="field">
        <label htmlFor="scale-test">Escribí o pegá el número de la etiqueta (13 dígitos)</label>
        <input
          id="scale-test"
          inputMode="numeric"
          autoComplete="off"
          placeholder="Ej: 2004176426006"
          value={testCode}
          onChange={(e) => setTestCode(e.target.value)}
        />
      </div>
      {trimmed && !parsed && (
        <p className="error">
          No se reconoce como etiqueta de balanza con esta configuración (revisá el prefijo, las posiciones y el dígito
          de control).
        </p>
      )}
      {parsed && (
        <div className="purchase-total">
          <div>PLU: {parsed.plu}</div>
          <div>
            {parsed.valueType === 'quantity'
              ? `Peso de la etiqueta: ${formatQuantity(parsed.value, 'weight')}`
              : `Importe de la etiqueta: ${money(parsed.value)}`}
          </div>
          {matched ? (
            <>
              <div>
                Producto: {matched.name} ({money(matched.price)} por kg)
              </div>
              {line && (
                <div>
                  En el remito: {formatQuantity(line.quantity, 'weight')} —{' '}
                  {money(line.quantity * Number(matched.price))}
                </div>
              )}
              {line?.priceMismatch && (
                <div className="error">
                  El importe no coincide con el precio cargado en el sistema: revisá que el precio de la balanza y el
                  del producto sean el mismo.
                </div>
              )}
            </>
          ) : (
            <div className="error">Ningún producto tiene asignado el PLU {parsed.plu}.</div>
          )}
        </div>
      )}

      <h3>Productos con PLU de balanza</h3>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>PLU</th>
              <th>Producto</th>
              <th>Precio por kg</th>
              <th>Stock</th>
            </tr>
          </thead>
          <tbody>
            {productsWithPlu.length === 0 && (
              <tr>
                <td colSpan={4} className="list-search-empty">
                  Todavía no hay productos con PLU. Editá un producto por peso y cargale el PLU de la balanza.
                </td>
              </tr>
            )}
            {productsWithPlu.map((p) => (
              <tr key={p.id}>
                <td data-label="PLU">{p.scalePlu}</td>
                <td data-label="Producto">{p.name}</td>
                <td data-label="Precio por kg">{money(p.price)}</td>
                <td data-label="Stock">{formatQuantity(p.stock, p.unitType)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

export default ScaleSettings;
