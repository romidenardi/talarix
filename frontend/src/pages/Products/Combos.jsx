import { useState } from 'react';
import { useDialog } from '../../context/DialogContext.jsx';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { createCombo, updateCombo, deleteCombo } from '../../api/combos.api.js';
import FormMessage from '../../components/common/FormMessage.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { serverMessage } from '../../utils/serverErrors.js';
import SearchSelect from '../../components/common/SearchSelect.jsx';
import SearchInput from '../../components/common/SearchInput.jsx';
import { matchesSearch } from '../../utils/search.js';
import { RequiredMark, RequiredLegend } from '../../components/common/Required.jsx';
import { isVariantGroup } from '../../utils/variants.js';

const money = (value) => `$${(Number(value) || 0).toFixed(2)}`;

const emptyComponent = () => ({ productId: '', quantity: 1 });
const emptyForm = () => ({
  internalCode: '',
  barcode: '',
  name: '',
  categoryId: '',
  specialPrice: '',
  description: '',
  active: 'true',
  components: [emptyComponent()],
});

const blockEnter = (e) => {
  if (e.key === 'Enter') e.preventDefault();
};

const ComboForm = ({
  idPrefix,
  defaultValues,
  products,
  categories,
  submitLabel,
  showActive = false,
  onSubmit,
  onCancel,
  className,
}) => {
  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    formState: { errors },
  } = useForm({ defaultValues });
  const { fields, append, remove } = useFieldArray({ control, name: 'components' });
  const formMsg = useMessage();
  const watchedComponents = watch('components');
  const watchedSpecial = watch('specialPrice');

  const productMap = new Map(products.map((p) => [p.id, p]));
  const productOptions = products.map((p) => ({
    value: p.id,
    label: p.name,
    detail: [p.internalCode && `Cód. ${p.internalCode}`, money(p.price), `Stock: ${p.stock}`]
      .filter(Boolean)
      .join(' · '),
    keywords: [p.internalCode, p.barcode, p.brand, p.model],
  }));

  const totals = (watchedComponents || []).reduce(
    (acc, row) => {
      const product = productMap.get(row.productId);
      const quantity = Number(row.quantity) || 0;
      if (!product) return acc;
      return {
        listPrice: acc.listPrice + Number(product.price) * quantity,
        cost: acc.cost + Number(product.cost) * quantity,
      };
    },
    { listPrice: 0, cost: 0 },
  );

  const hasSpecial = watchedSpecial !== '' && watchedSpecial !== undefined && watchedSpecial !== null;
  const specialPrice = hasSpecial ? Number(watchedSpecial) || 0 : null;
  const finalPrice = hasSpecial ? specialPrice : totals.listPrice;

  const submit = async (formData) => {
    const payload = {
      internalCode: formData.internalCode,
      barcode: formData.barcode || null,
      name: formData.name,
      categoryId: formData.categoryId || null,
      description: formData.description || null,
      specialPrice: formData.specialPrice === '' ? null : Number(formData.specialPrice),
      components: formData.components.map((c) => ({ productId: c.productId, quantity: Number(c.quantity) })),
    };
    if (showActive) payload.active = formData.active === 'true';

    const result = await onSubmit(payload);
    if (!result.success) {
      formMsg.error(result.message);
    } else if (!onCancel) {
      reset(emptyForm());
      formMsg.success('Combo creado');
    }
  };

  return (
    <form onSubmit={handleSubmit(submit)} className={className}>
      <div className="field">
        <label htmlFor={`${idPrefix}-internalCode`}>
          Código interno
          <RequiredMark />
        </label>
        <input
          id={`${idPrefix}-internalCode`}
          placeholder="Ej: C001"
          {...register('internalCode', { required: 'Obligatorio' })}
        />
        {errors.internalCode && <span className="error">{errors.internalCode.message}</span>}
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-barcode`}>Código de barras</label>
        <input id={`${idPrefix}-barcode`} placeholder="Opcional" {...register('barcode')} onKeyDown={blockEnter} />
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-name`}>
          Combo
          <RequiredMark />
        </label>
        <input
          id={`${idPrefix}-name`}
          placeholder="Ej: Pack cerveza + maní"
          {...register('name', { required: 'Obligatorio' })}
        />
        {errors.name && <span className="error">{errors.name.message}</span>}
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-categoryId`}>Categoría</label>
        <select id={`${idPrefix}-categoryId`} {...register('categoryId')}>
          <option value="">Sin categoría</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor={`${idPrefix}-specialPrice`}>
          Precio especial <small>(opcional)</small>
        </label>
        <input
          id={`${idPrefix}-specialPrice`}
          type="number"
          step="0.01"
          min="0"
          placeholder="Si lo dejás vacío, suma los precios"
          {...register('specialPrice')}
        />
      </div>

      {showActive && (
        <div className="field">
          <label htmlFor={`${idPrefix}-active`}>Estado</label>
          <select id={`${idPrefix}-active`} {...register('active')}>
            <option value="true">Activo</option>
            <option value="false">Inactivo</option>
          </select>
        </div>
      )}

      <div className="field field-full">
        <label htmlFor={`${idPrefix}-description`}>Descripción</label>
        <textarea id={`${idPrefix}-description`} {...register('description')} />
      </div>

      <div className="field field-full">
        <strong>Productos del combo</strong>
        <div className="purchase-items">
          {fields.map((field, index) => (
            <div key={field.id} className="purchase-item-row">
              <div className="field">
                <label htmlFor={`${idPrefix}-component-${index}`}>
                  Producto
                  <RequiredMark />
                </label>
                <Controller
                  name={`components.${index}.productId`}
                  control={control}
                  rules={{ required: true }}
                  render={({ field: productField }) => (
                    <SearchSelect
                      id={`${idPrefix}-component-${index}`}
                      title="Buscar producto"
                      searchPlaceholder="Nombre, código, marca o modelo..."
                      placeholder="Elegí un producto..."
                      emptyText="No hay productos que coincidan"
                      value={productField.value}
                      onChange={productField.onChange}
                      options={productOptions}
                      hasError={Boolean(errors.components?.[index]?.productId)}
                    />
                  )}
                />
              </div>
              <div className="field">
                <label htmlFor={`${idPrefix}-quantity-${index}`}>
                  Cantidad
                  <RequiredMark />
                </label>
                <input
                  id={`${idPrefix}-quantity-${index}`}
                  type="number"
                  min="1"
                  step="1"
                  {...register(`components.${index}.quantity`, { required: true, min: 1 })}
                />
              </div>
              <div className="field item-remove-field">
                <label aria-hidden="true">&nbsp;</label>
                <button
                  type="button"
                  onClick={() => remove(index)}
                  disabled={fields.length === 1}
                  style={{ visibility: fields.length === 1 ? 'hidden' : 'visible' }}
                >
                  Quitar
                </button>
              </div>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => append(emptyComponent())}>
          + Agregar producto
        </button>
      </div>

      <div className="purchase-total field-full">
        <div>Suma de precios: {money(totals.listPrice)}</div>
        <div>Costo: {money(totals.cost)}</div>
        {hasSpecial && <div>Precio especial: {money(specialPrice)}</div>}
        <div>Precio final del combo: {money(finalPrice)}</div>
        {hasSpecial && specialPrice > totals.listPrice && totals.listPrice > 0 && (
          <div className="error">El precio especial es mayor que la suma de los productos</div>
        )}
        {finalPrice > 0 && finalPrice < totals.cost && (
          <div className="error">El precio final es menor que el costo</div>
        )}
      </div>

      <div className={onCancel ? 'inline-edit-actions' : undefined}>
        <button type="submit">{submitLabel}</button>
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancelar
          </button>
        )}
      </div>
      <FormMessage message={formMsg.message} onClose={formMsg.clear} />
      <RequiredLegend />
    </form>
  );
};

const Combos = ({ products, categories, onChanged }) => {
  const msg = useMessage();
  const dialog = useDialog();
  const [editingId, setEditingId] = useState(null);
  const [search, setSearch] = useState('');

  const combos = products.filter((p) => p.isCombo);

  // En un combo va la variante, no el producto principal
  const singles = products.filter((p) => !p.isCombo && p.unitType !== 'weight' && !isVariantGroup(p));

  const categoryName = (categoryId) => categories.find((c) => c.id === categoryId)?.name || '—';

  // Devuelve { success } o { success: false, message }; cada formulario o fila muestra su aviso
  const run = async (action, fallbackMessage) => {
    try {
      await action();
      await onChanged();
      return { success: true };
    } catch (err) {
      return { success: false, message: serverMessage(err, fallbackMessage) };
    }
  };

  const onCreate = (payload) => run(() => createCombo(payload), 'No se pudo crear el combo');

  const onUpdate = async (payload) => {
    const comboId = editingId;
    const result = await run(() => updateCombo(comboId, payload), 'No se pudo guardar el combo');
    if (result.success) {
      setEditingId(null);
      msg.success('Cambios guardados', comboId);
    }
    return result;
  };

  const onDelete = async (combo) => {
    if (
      !(await dialog.confirm({
        message: `¿Eliminar el combo "${combo.name}"? Los productos que lo forman no se tocan.`,
        confirmLabel: 'Eliminar',
        danger: true,
      }))
    )
      return;
    const result = await run(() => deleteCombo(combo.id), 'No se pudo eliminar el combo');
    if (result.success) msg.success('Combo eliminado', 'list');
    else msg.error(result.message, combo.id);
  };

  const editDefaults = (combo) => ({
    internalCode: combo.internalCode || '',
    barcode: combo.barcode || '',
    name: combo.name || '',
    categoryId: combo.categoryId || '',
    specialPrice: combo.specialPrice ?? '',
    description: combo.description || '',
    active: String(combo.active),
    components: (combo.components || []).map((c) => ({ productId: c.productId, quantity: c.quantity })),
  });

  // La fila que se está editando sigue visible aunque el filtro no la incluya
  const visibleCombos = combos.filter(
    (c) =>
      c.id === editingId ||
      matchesSearch(search, [
        c.name,
        c.internalCode,
        c.barcode,
        categoryName(c.categoryId),
        ...(c.components || []).map((x) => x.name),
      ]),
  );

  return (
    <>
      <p className="report-note">
        El precio y el costo del combo se calculan con los valores actuales de sus productos. Si cargás un precio
        especial, ese precio queda fijo. El stock se calcula con el de los productos que lo forman.
      </p>

      <ComboForm
        idPrefix="new-combo"
        className="product-form"
        defaultValues={emptyForm()}
        products={singles}
        categories={categories}
        submitLabel="Agregar combo"
        onSubmit={onCreate}
      />

      <SearchInput
        id="combo-search"
        label="Buscar combos"
        placeholder="Buscar por combo, código, categoría o producto incluido..."
        value={search}
        onChange={setSearch}
      />

      <FormMessage message={msg.at('list')} />
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Combo</th>
              <th>Contiene</th>
              <th>Precio</th>
              <th>Costo</th>
              <th>Stock</th>
              <th>Estado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visibleCombos.length === 0 && (
              <tr>
                <td colSpan={8} className="list-search-empty">
                  {search ? 'No hay combos que coincidan con la búsqueda' : 'Todavía no hay combos'}
                </td>
              </tr>
            )}
            {visibleCombos.map((combo) => (
              <tr key={combo.id}>
                {editingId === combo.id ? (
                  <td colSpan={8} className="edit-cell">
                    <ComboForm
                      idPrefix={`edit-combo-${combo.id}`}
                      className="inline-edit-form"
                      defaultValues={editDefaults(combo)}
                      products={singles}
                      categories={categories}
                      submitLabel="Guardar"
                      showActive
                      onSubmit={onUpdate}
                      onCancel={() => setEditingId(null)}
                    />
                  </td>
                ) : (
                  <>
                    <td data-label="Código">{combo.internalCode}</td>
                    <td data-label="Combo">{combo.name}</td>
                    <td data-label="Contiene">
                      {(combo.components || []).map((c) => `${c.quantity}× ${c.name}`).join(', ') || '—'}
                    </td>
                    <td data-label="Precio">
                      {money(combo.price)}
                      {combo.specialPrice !== null && combo.specialPrice !== undefined && (
                        <small> (especial; suma {money(combo.listPrice)})</small>
                      )}
                    </td>
                    <td data-label="Costo">{money(combo.cost)}</td>
                    <td data-label="Stock">{combo.stock}</td>
                    <td data-label="Estado">{combo.active ? 'Activo' : 'Inactivo'}</td>
                    <td data-label="Acciones">
                      <button type="button" onClick={() => setEditingId(combo.id)}>
                        Editar
                      </button>
                      <button type="button" onClick={() => onDelete(combo)}>
                        Eliminar
                      </button>
                      <FormMessage message={msg.at(combo.id)} onClose={msg.clear} />
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
};

export default Combos;
