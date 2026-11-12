import { useState, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { useDialog } from '../../context/DialogContext.jsx';
import { useResource } from '../../hooks/useResource.js';
import * as productsApi from '../../api/products.api.js';
import StockMovementPanel from '../../components/common/StockMovementPanel.jsx';
import Spinner from '../../components/common/Spinner.jsx';
import SearchInput from '../../components/common/SearchInput.jsx';
import VatSelect from '../../components/common/VatSelect.jsx';
import FormMessage from '../../components/common/FormMessage.jsx';
import { RequiredMark, RequiredLegend } from '../../components/common/Required.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { applyServerFieldErrors, fieldFromMessage } from '../../utils/serverErrors.js';
import { matchesSearch } from '../../utils/search.js';
import { formatQuantity } from '../../utils/quantity.js';
import { formatRate, vatToFormValue } from '../../utils/taxes.js';

// Insumos: lo que el comercio compra y gasta pero no vende (envases, bolsas, limpieza, materia
// prima). Son productos marcados como insumo: llevan stock y costo, se cargan en Compras y se
// descuentan con movimientos de stock, pero no aparecen en Productos, remitos ni combos.
const api = {
  getAll: () => productsApi.getProducts('supply'),
  create: productsApi.createProduct,
  update: productsApi.updateProduct,
  remove: productsApi.deleteProduct,
};

const SUPPLY_FIELDS = ['internalCode', 'barcode', 'name', 'cost'];
const MESSAGE_FIELDS = { barcode: /código de barras/i, internalCode: /código interno/i };

const emptySupply = () => ({ internalCode: '', barcode: '', name: '', unitType: 'unit', cost: '', vatRate: '21' });

const money = (value) =>
  `$${(Number(value) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const toPayload = (formData) => ({
  internalCode: formData.internalCode.trim(),
  barcode: formData.barcode?.trim() || null,
  name: formData.name.trim(),
  unitType: formData.unitType,
  cost: Number(formData.cost) || 0,
  vatRate: Number(formData.vatRate),
});

const Supplies = () => {
  const { items: supplies, loading, loadError, create, update, remove, reload } = useResource(api);
  const msg = useMessage();
  const dialog = useDialog();
  const [editingId, setEditingId] = useState(null);
  const [stockPanelId, setStockPanelId] = useState(null);
  const [search, setSearch] = useState('');

  const createForm = useForm({ defaultValues: emptySupply() });
  const editForm = useForm();
  const { errors } = createForm.formState;
  const { errors: editErrors } = editForm.formState;
  const createUnitType = createForm.watch('unitType');
  const editUnitType = editForm.watch('unitType');

  // Error del servidor debajo del campo que corresponda, o junto al botón
  const showServerError = (result, form, key) => {
    if (applyServerFieldErrors(result.error, form.setError, SUPPLY_FIELDS)) return;
    const field = fieldFromMessage(result.message, MESSAGE_FIELDS);
    if (field) form.setError(field, { type: 'server', message: result.message });
    else msg.error(result.message, key);
  };

  const onCreate = async (formData) => {
    // Sin precio de venta: el servidor lo deja en 0 por ser insumo
    const result = await create({ ...toPayload(formData), price: 0, isSupply: true });
    if (result.success) {
      createForm.reset(emptySupply());
      msg.success('Insumo agregado', 'create');
    } else {
      showServerError(result, createForm, 'create');
    }
  };

  const startEdit = (supply) => {
    setEditingId(supply.id);
    setStockPanelId(null);
    msg.clear();
    editForm.reset({
      internalCode: supply.internalCode || '',
      barcode: supply.barcode || '',
      name: supply.name || '',
      unitType: supply.unitType || 'unit',
      cost: supply.cost ?? '',
      vatRate: vatToFormValue(supply.vatRate),
      active: String(supply.active ?? true),
    });
  };

  const onUpdate = async (formData) => {
    const result = await update(editingId, { ...toPayload(formData), active: formData.active === 'true' });
    if (result.success) {
      const savedId = editingId;
      setEditingId(null);
      msg.success('Cambios guardados', savedId);
    } else {
      showServerError(result, editForm, 'edit');
    }
  };

  const onDelete = async (supply) => {
    if (
      !(await dialog.confirm({
        message: `¿Eliminar el insumo "${supply.name}"? Si ya tiene compras o movimientos, no se puede: desactivalo.`,
        confirmLabel: 'Eliminar',
        danger: true,
      }))
    )
      return;
    const result = await remove(supply.id);
    if (result.success) msg.success('Insumo eliminado.', 'list');
    else msg.error(result.message, supply.id);
  };

  const visible = supplies
    .filter((s) => s.id === editingId || matchesSearch(search, [s.name, s.internalCode, s.barcode]))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'));

  // Campos compartidos por el alta y la edición
  const fields = (form, formErrors, unitType, prefix) => (
    <>
      <div className="field">
        <label htmlFor={`${prefix}-internalCode`}>
          Código interno
          <RequiredMark />
        </label>
        <input
          id={`${prefix}-internalCode`}
          placeholder="Ej: INS-001"
          {...form.register('internalCode', { validate: (v) => Boolean(v?.trim()) || 'Cargá el código interno.' })}
        />
        {formErrors.internalCode && <span className="error">{formErrors.internalCode.message}</span>}
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-name`}>
          Nombre
          <RequiredMark />
        </label>
        <input
          id={`${prefix}-name`}
          placeholder="Ej: Bolsas camiseta 40x50"
          {...form.register('name', { validate: (v) => Boolean(v?.trim()) || 'Cargá el nombre.' })}
        />
        {formErrors.name && <span className="error">{formErrors.name.message}</span>}
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-barcode`}>Código de barras</label>
        <input id={`${prefix}-barcode`} {...form.register('barcode')} />
        {formErrors.barcode && <span className="error">{formErrors.barcode.message}</span>}
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-unitType`}>Se maneja por</label>
        <select id={`${prefix}-unitType`} {...form.register('unitType')}>
          <option value="unit">Unidad</option>
          <option value="weight">Peso (kg)</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-cost`}>{unitType === 'weight' ? 'Costo por kg sin IVA' : 'Costo sin IVA'}</label>
        <input
          id={`${prefix}-cost`}
          type="number"
          step="0.01"
          placeholder="Ej: 2500"
          {...form.register('cost', { min: { value: 0, message: 'El costo no puede ser negativo.' } })}
        />
        {formErrors.cost && <span className="error">{formErrors.cost.message}</span>}
      </div>
      <div className="field">
        <label htmlFor={`${prefix}-vatRate`}>IVA de compra</label>
        <VatSelect id={`${prefix}-vatRate`} registration={form.register('vatRate')} />
      </div>
    </>
  );

  if (loading) return <Spinner label="Cargando insumos y servicios..." />;

  return (
    <div className="supplies-page">
      <h1>Insumos y servicios</h1>
      <p className="report-note">
        <strong>Insumos:</strong> lo que comprás y usás pero no vendés (envases, bolsas, artículos de limpieza, materia
        prima). Llevan stock y costo, se cargan en Compras y no aparecen en Productos ni en los remitos. Para registrar
        lo que se usa, entrá en Stock y cargá un egreso.
      </p>
      <p className="report-note">
        <strong>Servicios y gastos</strong> (alquiler, luz, fletes, honorarios): no llevan stock, así que no se dan de
        alta acá. Se cargan directamente en <Link to="/purchases">Compras</Link>, con «+ Agregar servicio o gasto».
      </p>
      <FormMessage message={loadError ? { type: 'error', text: loadError } : null} />

      <form onSubmit={createForm.handleSubmit(onCreate)} className="supply-form">
        {fields(createForm, errors, createUnitType, 'new')}
        <button type="submit">Agregar insumo</button>
        <FormMessage message={msg.at('create')} onClose={msg.clear} />
        <RequiredLegend />
      </form>

      <SearchInput
        id="supply-search"
        label="Buscar insumos"
        placeholder="Buscar por nombre o código..."
        value={search}
        onChange={setSearch}
      />

      <FormMessage message={msg.at('list')} />
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Nombre</th>
              <th>Stock</th>
              <th>Costo sin IVA</th>
              <th>IVA</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="list-search-empty">
                  {search ? 'No hay insumos que coincidan con la búsqueda.' : 'Todavía no hay insumos.'}
                </td>
              </tr>
            )}
            {visible.map((supply) => (
              <Fragment key={supply.id}>
                <tr>
                  {editingId === supply.id ? (
                    <td colSpan={6} className="edit-cell">
                      <form onSubmit={editForm.handleSubmit(onUpdate)} className="inline-edit-form">
                        {fields(editForm, editErrors, editUnitType, `edit-${supply.id}`)}
                        <div className="field">
                          <label htmlFor={`edit-${supply.id}-active`}>Estado</label>
                          <select id={`edit-${supply.id}-active`} {...editForm.register('active')}>
                            <option value="true">Activo</option>
                            <option value="false">Inactivo</option>
                          </select>
                        </div>
                        <div className="inline-edit-actions">
                          <button type="submit">Guardar</button>
                          <button type="button" onClick={() => setEditingId(null)}>
                            Cancelar
                          </button>
                        </div>
                        <FormMessage message={msg.at('edit')} onClose={msg.clear} />
                        <RequiredLegend />
                      </form>
                    </td>
                  ) : (
                    <>
                      <td data-label="Código">{supply.internalCode}</td>
                      <td data-label="Nombre">
                        {supply.name}
                        {supply.active === false && <small> · Inactivo</small>}
                      </td>
                      <td data-label="Stock">{formatQuantity(supply.stock, supply.unitType)}</td>
                      <td data-label="Costo sin IVA">
                        {money(supply.cost)}
                        {supply.unitType === 'weight' && <small> por kg</small>}
                      </td>
                      <td data-label="IVA">{formatRate(supply.vatRate)}</td>
                      <td data-label="Acciones">
                        <button onClick={() => startEdit(supply)}>Editar</button>
                        <button onClick={() => setStockPanelId(stockPanelId === supply.id ? null : supply.id)}>
                          {stockPanelId === supply.id ? 'Cerrar stock' : 'Stock'}
                        </button>
                        <button onClick={() => onDelete(supply)}>Eliminar</button>
                        <FormMessage message={msg.at(supply.id)} onClose={msg.clear} />
                      </td>
                    </>
                  )}
                </tr>
                {stockPanelId === supply.id && (
                  <tr>
                    <td colSpan={6} className="edit-cell">
                      <StockMovementPanel product={supply} onStockChange={reload} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Supplies;
