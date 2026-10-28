import { Fragment, useState } from 'react';
import { useDialog } from '../../context/DialogContext.jsx';
import * as productsApi from '../../api/products.api.js';
import StockMovementPanel from '../../components/common/StockMovementPanel.jsx';
import FormMessage from '../../components/common/FormMessage.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { serverMessage } from '../../utils/serverErrors.js';
import { formatQuantity } from '../../utils/quantity.js';
import { combinations, parseValues, valuesKey, MAX_VARIANTS } from '../../utils/variants.js';

const money = (value) =>
  `$${(Number(value) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

// Valores que ya usan las variantes, por atributo (para sumar combinaciones nuevas)
const usedValues = (variants, index) => {
  const seen = new Map();
  for (const v of variants) {
    const value = (v.variantValues || [])[index];
    if (value && !seen.has(value.toLowerCase())) seen.set(value.toLowerCase(), value);
  }
  return [...seen.values()];
};

// Variantes de un producto: editar código, código de barras, precio propio, costo, valores y estado;
// stock de cada una; agregar combinaciones nuevas.
export default function VariantsPanel({ parent, variants, onChanged }) {
  const attributes = parent.variantAttributes || [];
  const msg = useMessage();
  const dialog = useDialog();
  const [editingId, setEditingId] = useState(null);
  const [form, setForm] = useState(null);
  const [stockId, setStockId] = useState(null);
  const [saving, setSaving] = useState(false);
  const [newValues, setNewValues] = useState(attributes.map(() => ''));

  const startEdit = (variant) => {
    msg.clear();
    setStockId(null);
    setEditingId(variant.id);
    setForm({
      values: attributes.map((_, i) => (variant.variantValues || [])[i] || ''),
      internalCode: variant.internalCode || '',
      barcode: variant.barcode || '',
      inherit: !variant.ownPrice,
      price: variant.price,
      cost: variant.cost,
      active: variant.active !== false,
    });
  };

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const save = async (e) => {
    e.preventDefault();
    if (!form.internalCode.trim()) return msg.error('El código interno es obligatorio', editingId);
    if (form.values.some((v) => !v.trim())) return msg.error('Completá el valor de cada atributo', editingId);
    if (!form.inherit && !(Number(form.price) >= 0)) return msg.error('El precio no es válido', editingId);
    setSaving(true);
    try {
      await productsApi.updateProduct(editingId, {
        variantValues: form.values.map((v) => v.trim()),
        internalCode: form.internalCode.trim(),
        barcode: form.barcode.trim() || null,
        cost: Number(form.cost) || 0,
        active: form.active,
        ...(form.inherit ? { ownPrice: false } : { price: Number(form.price) }),
      });
      const savedId = editingId;
      setEditingId(null);
      await onChanged();
      msg.success('Variante guardada', savedId);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo guardar la variante'), editingId);
    } finally {
      setSaving(false);
    }
    return undefined;
  };

  const remove = async (variant) => {
    if (
      !(await dialog.confirm({
        message: `¿Eliminar la variante ${variant.variantValues?.join(' / ')}?`,
        confirmLabel: 'Eliminar',
        danger: true,
      }))
    )
      return;
    try {
      await productsApi.deleteProduct(variant.id);
      await onChanged();
      msg.success('Variante eliminada', 'variants');
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo eliminar la variante'), variant.id);
    }
  };

  // Combinaciones nuevas: un atributo vacío usa los valores que ya tiene (para sumar, por ejemplo,
  // un color nuevo en todos los talles)
  const existingKeys = new Set(variants.map((v) => valuesKey(v.variantValues || [])));
  const valuesByAttribute = attributes.map((_, i) => {
    const typed = parseValues(newValues[i]);
    return typed.length ? typed : usedValues(variants, i);
  });
  const typedSomething = newValues.some((v) => v.trim());
  const toAdd = typedSomething
    ? combinations(valuesByAttribute).filter((values) => !existingKeys.has(valuesKey(values)))
    : [];

  const add = async (e) => {
    e.preventDefault();
    if (!toAdd.length) return msg.error('Esas combinaciones ya existen', 'add');
    if (variants.length + toAdd.length > MAX_VARIANTS) {
      return msg.error(`Un producto puede tener hasta ${MAX_VARIANTS} variantes`, 'add');
    }
    setSaving(true);
    try {
      await productsApi.addVariants(
        parent.id,
        toAdd.map((values) => ({ values })),
      );
      setNewValues(attributes.map(() => ''));
      await onChanged();
      msg.success(`${toAdd.length === 1 ? 'Se agregó 1 variante' : `Se agregaron ${toAdd.length} variantes`}`, 'add');
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudieron agregar las variantes'), 'add');
    } finally {
      setSaving(false);
    }
    return undefined;
  };

  const columns = attributes.length + 7;

  return (
    <div className="variants-panel">
      <FormMessage message={msg.at('variants')} />
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              {attributes.map((name) => (
                <th key={name}>{name}</th>
              ))}
              <th>Código</th>
              <th>Código de barras</th>
              <th>Precio</th>
              <th>Costo</th>
              <th>Stock</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {variants.length === 0 && (
              <tr>
                <td colSpan={columns} className="list-search-empty">
                  No tiene variantes: agregalas abajo.
                </td>
              </tr>
            )}
            {variants.map((variant) => (
              <Fragment key={variant.id}>
                <tr>
                  {editingId === variant.id ? (
                    <td colSpan={columns} className="edit-cell">
                      <form className="inline-edit-form" onSubmit={save}>
                        {attributes.map((name, i) => (
                          <div className="field" key={name}>
                            <label htmlFor={`variant-${variant.id}-v${i}`}>{name}</label>
                            <input
                              id={`variant-${variant.id}-v${i}`}
                              value={form.values[i]}
                              onChange={(e) =>
                                set(
                                  'values',
                                  form.values.map((v, j) => (j === i ? e.target.value : v)),
                                )
                              }
                            />
                          </div>
                        ))}
                        <div className="field">
                          <label htmlFor={`variant-${variant.id}-code`}>Código interno</label>
                          <input
                            id={`variant-${variant.id}-code`}
                            value={form.internalCode}
                            onChange={(e) => set('internalCode', e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`variant-${variant.id}-barcode`}>Código de barras</label>
                          <input
                            id={`variant-${variant.id}-barcode`}
                            value={form.barcode}
                            onChange={(e) => set('barcode', e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && e.preventDefault()}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`variant-${variant.id}-inherit`}>
                            <input
                              id={`variant-${variant.id}-inherit`}
                              type="checkbox"
                              checked={form.inherit}
                              onChange={(e) => set('inherit', e.target.checked)}
                            />{' '}
                            Precio del producto ({money(parent.price)})
                          </label>
                          {!form.inherit && (
                            <input
                              aria-label="Precio propio"
                              type="number"
                              step="0.01"
                              min="0"
                              value={form.price}
                              onChange={(e) => set('price', e.target.value)}
                            />
                          )}
                        </div>
                        <div className="field">
                          <label htmlFor={`variant-${variant.id}-cost`}>Costo</label>
                          <input
                            id={`variant-${variant.id}-cost`}
                            type="number"
                            step="0.01"
                            min="0"
                            value={form.cost}
                            onChange={(e) => set('cost', e.target.value)}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`variant-${variant.id}-active`}>Estado</label>
                          <select
                            id={`variant-${variant.id}-active`}
                            value={String(form.active)}
                            onChange={(e) => set('active', e.target.value === 'true')}
                          >
                            <option value="true">Activa</option>
                            <option value="false">Inactiva</option>
                          </select>
                        </div>
                        <div className="inline-edit-actions">
                          <button type="submit" disabled={saving}>
                            {saving ? 'Guardando…' : 'Guardar'}
                          </button>
                          <button type="button" onClick={() => setEditingId(null)}>
                            Cancelar
                          </button>
                        </div>
                        <FormMessage message={msg.at(variant.id)} onClose={msg.clear} />
                      </form>
                    </td>
                  ) : (
                    <>
                      {attributes.map((name, i) => (
                        <td key={name} data-label={name}>
                          {(variant.variantValues || [])[i]}
                        </td>
                      ))}
                      <td data-label="Código">{variant.internalCode}</td>
                      <td data-label="Código de barras">{variant.barcode || '—'}</td>
                      <td data-label="Precio">
                        {money(variant.price)}
                        {variant.ownPrice && <small> · propio</small>}
                      </td>
                      <td data-label="Costo">{money(variant.cost)}</td>
                      <td data-label="Stock">{formatQuantity(variant.stock, 'unit')}</td>
                      <td data-label="Estado">{variant.active === false ? 'Inactiva' : 'Activa'}</td>
                      <td data-label="Acciones">
                        <button type="button" onClick={() => startEdit(variant)}>
                          Editar
                        </button>
                        <button type="button" onClick={() => setStockId(stockId === variant.id ? null : variant.id)}>
                          {stockId === variant.id ? 'Cerrar stock' : 'Stock'}
                        </button>
                        <button type="button" onClick={() => remove(variant)}>
                          Eliminar
                        </button>
                        <FormMessage message={msg.at(variant.id)} onClose={msg.clear} />
                      </td>
                    </>
                  )}
                </tr>
                {stockId === variant.id && (
                  <tr>
                    <td colSpan={columns} className="edit-cell">
                      <StockMovementPanel product={variant} onStockChange={onChanged} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <form className="inline-edit-form variants-add" onSubmit={add}>
        <strong className="field-full">Agregar variantes</strong>
        {attributes.map((name, i) => (
          <div className="field" key={name}>
            <label htmlFor={`add-${parent.id}-v${i}`}>{name}</label>
            <input
              id={`add-${parent.id}-v${i}`}
              placeholder={`Vacío = los ${name.toLowerCase()} que ya tiene`}
              value={newValues[i]}
              onChange={(e) => setNewValues(newValues.map((v, j) => (j === i ? e.target.value : v)))}
            />
          </div>
        ))}
        <p className="report-note field-full">
          Valores separados por coma. Por ejemplo, para sumar un color nuevo en todos los talles, escribí solo el color.
          {toAdd.length > 0 &&
            ` Se van a agregar ${toAdd.length}: ${toAdd
              .slice(0, 6)
              .map((v) => v.join(' / '))
              .join(', ')}${toAdd.length > 6 ? ` y ${toAdd.length - 6} más` : ''}.`}
        </p>
        <div className="inline-edit-actions">
          <button type="submit" disabled={saving || !toAdd.length}>
            Agregar
          </button>
        </div>
        <FormMessage message={msg.at('add')} onClose={msg.clear} />
      </form>
    </div>
  );
}
