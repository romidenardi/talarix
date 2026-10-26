import { useState, useEffect, Fragment } from 'react';
import { useDialog } from '../../context/DialogContext.jsx';
import { useForm } from 'react-hook-form';
import { useResource } from '../../hooks/useResource.js';
import * as productsApi from '../../api/products.api.js';
import { getCategories } from '../../api/categories.api.js';
import StockMovementPanel from '../../components/common/StockMovementPanel.jsx';
import BarcodeScanner from '../../components/common/BarcodeScanner.jsx';
import Spinner from '../../components/common/Spinner.jsx';
import SearchInput from '../../components/common/SearchInput.jsx';
import Combos from './Combos.jsx';
import ScaleSettings from './ScaleSettings.jsx';
import { matchesSearch } from '../../utils/search.js';
import VatSelect from '../../components/common/VatSelect.jsx';
import { toPercentOrNull, vatToFormValue } from '../../utils/taxes.js';
import { formatQuantity, PRICE_BASES, toPricePerKg, perKg } from '../../utils/quantity.js';
import FormMessage from '../../components/common/FormMessage.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { applyServerFieldErrors, fieldFromMessage } from '../../utils/serverErrors.js';
import { RequiredMark, RequiredLegend } from '../../components/common/Required.jsx';

const api = {
  getAll: productsApi.getProducts,
  create: productsApi.createProduct,
  update: productsApi.updateProduct,
  remove: productsApi.deleteProduct,
};

const Products = () => {
  const {
    items: products,
    loading,
    loadError,
    create,
    update,
    remove,
    reload,
  } = useResource(api, { reloadAfterChange: true });
  const msg = useMessage();
  const dialog = useDialog();

  // Campos que el servidor puede marcar, y errores del servidor que hablan de un campo concreto
  const PRODUCT_FIELDS = ['internalCode', 'barcode', 'scalePlu', 'name', 'price', 'cost'];
  const MESSAGE_FIELDS = {
    barcode: /código de barras/i,
    scalePlu: /PLU/i,
  };
  // Muestra el error del servidor debajo del campo que corresponda, o junto al botón
  const showServerError = (result, form, key) => {
    if (applyServerFieldErrors(result.error, form.setError, PRODUCT_FIELDS)) return;
    const field = fieldFromMessage(result.message, MESSAGE_FIELDS);
    if (field) form.setError(field, { type: 'server', message: result.message });
    else msg.error(result.message, key);
  };
  const [categories, setCategories] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [stockPanelId, setStockPanelId] = useState(null);
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('products'); // 'products' | 'combos' | 'scale'

  const createForm = useForm({
    defaultValues: { unitType: 'unit', vatRate: '21', priceBase: '1000' },
  });
  const {
    register,
    handleSubmit,
    reset,
    setValue,
    watch,
    formState: { errors },
  } = createForm;
  const editForm = useForm();
  const { errors: editErrors } = editForm.formState;
  const createUnitType = watch('unitType');
  const editUnitType = editForm.watch('unitType');
  const createPriceBase = watch('priceBase');
  const createPrice = watch('price');
  const editPriceBase = editForm.watch('priceBase');
  const editPrice = editForm.watch('price');

  const money = (value) =>
    `$${(Number(value) || 0).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const perKgHint = (unitType, base, price) => {
    if (unitType !== 'weight' || !price) return null;
    const perKgPrice = toPricePerKg(price, base);
    return `Se guarda como ${money(perKgPrice)} por kg (${money(perKgPrice / 10)} cada 100 g).`;
  };
  const priceFields = (formData) => {
    const weight = formData.unitType === 'weight';
    const convert = (v) => (weight ? toPricePerKg(v, formData.priceBase) : Number(v));
    return {
      price: convert(formData.price),
      cost: convert(formData.cost),
      promoPrice: formData.promoPrice ? convert(formData.promoPrice) : null,
    };
  };
  const [scanTarget, setScanTarget] = useState(null); // 'create' | 'edit' | null

  const blockEnter = (e) => {
    if (e.key === 'Enter') e.preventDefault();
  };

  const handleScanned = (code) => {
    if (scanTarget === 'edit') editForm.setValue('barcode', code, { shouldDirty: true });
    else setValue('barcode', code, { shouldDirty: true });
    setScanTarget(null);
  };

  useEffect(() => {
    getCategories().then(({ data }) => setCategories(data));
  }, []);

  const flatCategories = categories.flatMap((c) => [c, ...(c.subcategories || [])]);

  const onCreate = async (formData) => {
    const { priceBase: _base, ...rest } = formData;
    const result = await create({
      ...rest,
      ...priceFields(formData),
      vatRate: Number(formData.vatRate),
      otherTaxes: toPercentOrNull(formData.otherTaxes),
      categoryId: formData.categoryId || null,
      scalePlu: formData.unitType === 'weight' && formData.scalePlu ? Number(formData.scalePlu) : null,
    });
    if (result.success) {
      reset({ unitType: 'unit', vatRate: '21', priceBase: '1000' });
      msg.success('Producto agregado', 'create');
    } else {
      showServerError(result, createForm, 'create');
    }
  };

  const startEdit = (product) => {
    setEditingId(product.id);
    msg.clear();
    setStockPanelId(null);
    editForm.reset({
      internalCode: product.internalCode || '',
      barcode: product.barcode || '',
      name: product.name || '',
      brand: product.brand || '',
      model: product.model || '',
      categoryId: product.categoryId || '',
      unitType: product.unitType || 'unit',
      scalePlu: product.scalePlu ?? '',
      priceBase: '1000',
      price: product.price,
      promoPrice: product.promoPrice || '',
      cost: product.cost,
      vatRate: vatToFormValue(product.vatRate),
      otherTaxes: product.otherTaxes ?? '',
      description: product.description || '',
      active: String(product.active),
    });
  };

  const onUpdate = async (formData) => {
    const { priceBase: _base, ...rest } = formData;
    const result = await update(editingId, {
      ...rest,
      ...priceFields(formData),
      vatRate: Number(formData.vatRate),
      otherTaxes: toPercentOrNull(formData.otherTaxes),
      categoryId: formData.categoryId || null,
      scalePlu: formData.unitType === 'weight' && formData.scalePlu ? Number(formData.scalePlu) : null,
      active: formData.active === 'true',
    });
    if (result.success) {
      const savedId = editingId;
      setEditingId(null);
      msg.success('Cambios guardados', savedId);
    } else {
      showServerError(result, editForm, 'edit');
    }
  };

  const onDelete = async (id) => {
    if (!(await dialog.confirm({ message: '¿Eliminar este producto?', confirmLabel: 'Eliminar', danger: true })))
      return;
    const result = await remove(id);
    if (result.success) msg.success('Producto eliminado', 'list');
    else msg.error(result.message, id);
  };

  const categoryName = (categoryId) => flatCategories.find((c) => c.id === categoryId)?.name || '—';

  // La fila que se está editando sigue visible aunque el filtro no la incluya
  const visibleProducts = products.filter(
    (p) =>
      !p.isCombo &&
      (p.id === editingId ||
        matchesSearch(search, [p.name, p.internalCode, p.barcode, p.brand, p.model, categoryName(p.categoryId)])),
  );

  const tabs = (
    <div className="report-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'products'}
        className={tab === 'products' ? 'active' : ''}
        onClick={() => setTab('products')}
      >
        Productos
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'combos'}
        className={tab === 'combos' ? 'active' : ''}
        onClick={() => setTab('combos')}
      >
        Combos
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={tab === 'scale'}
        className={tab === 'scale' ? 'active' : ''}
        onClick={() => setTab('scale')}
      >
        Balanza
      </button>
    </div>
  );

  if (loading) return <Spinner label="Cargando productos..." />;

  if (tab === 'combos') {
    return (
      <div className="products-page">
        <h1>Productos</h1>
        {tabs}
        <Combos products={products} categories={flatCategories} onChanged={reload} />
      </div>
    );
  }

  if (tab === 'scale') {
    return (
      <div className="products-page">
        <h1>Productos</h1>
        {tabs}
        <ScaleSettings products={products} />
      </div>
    );
  }

  return (
    <div className="products-page">
      <h1>Productos</h1>
      {tabs}
      <FormMessage message={loadError ? { type: 'error', text: loadError } : null} />

      <form onSubmit={handleSubmit(onCreate)} className="product-form">
        <div className="field">
          <label htmlFor="internalCode">
            Código interno
            <RequiredMark />
          </label>
          <input id="internalCode" placeholder="Ej: P001" {...register('internalCode', { required: 'Obligatorio' })} />
          {errors.internalCode && <span className="error">{errors.internalCode.message}</span>}
        </div>

        <div className="field">
          <label htmlFor="barcode">Código de barras</label>
          <div className="input-with-action">
            <input
              id="barcode"
              placeholder="Escribí o escaneá el código"
              {...register('barcode')}
              onKeyDown={blockEnter}
            />
            <button
              type="button"
              className="scan-button"
              title="Escanear con la cámara del celular"
              onClick={() => setScanTarget('create')}
            >
              Cámara
            </button>
          </div>
          {errors.barcode && <span className="error">{errors.barcode.message}</span>}
        </div>

        <div className="field">
          <label htmlFor="name">
            Producto
            <RequiredMark />
          </label>
          <input id="name" placeholder="Ej: Cerveza IPA 500ml" {...register('name', { required: 'Obligatorio' })} />
          {errors.name && <span className="error">{errors.name.message}</span>}
        </div>

        <div className="field">
          <label htmlFor="brand">Marca</label>
          <input id="brand" placeholder="Ej: Patagonia" {...register('brand')} />
        </div>

        <div className="field">
          <label htmlFor="model">Modelo</label>
          <input id="model" placeholder="Ej: IPA 2024" {...register('model')} />
        </div>

        <div className="field">
          <label htmlFor="categoryId">Categoría</label>
          <select id="categoryId" {...register('categoryId')}>
            <option value="">Sin categoría</option>
            {flatCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="unitType">Unidad de comercialización</label>
          <select id="unitType" {...register('unitType')}>
            <option value="unit">Por unidad</option>
            <option value="weight">Por peso</option>
          </select>
        </div>

        {createUnitType === 'weight' && (
          <div className="field">
            <label htmlFor="scalePlu">
              PLU de balanza <small>(opcional)</small>
            </label>
            <input
              id="scalePlu"
              type="number"
              min="1"
              max="9999"
              step="1"
              placeholder="Ej: 417"
              {...register('scalePlu')}
            />
            {errors.scalePlu && <span className="error">{errors.scalePlu.message}</span>}
          </div>
        )}

        {createUnitType === 'weight' && (
          <div className="field">
            <label htmlFor="priceBase">Cargo precio y costo por</label>
            <select id="priceBase" {...register('priceBase')}>
              {PRICE_BASES.map((b) => (
                <option key={b.value} value={b.value}>
                  {b.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label htmlFor="price">
            Precio{createUnitType === 'weight' ? ' (por la cantidad elegida)' : ''}
            <RequiredMark />
          </label>
          <input
            id="price"
            type="number"
            step="0.01"
            placeholder="Ej: 1500"
            {...register('price', {
              required: 'El precio es obligatorio',
              min: { value: 0, message: 'El precio no puede ser negativo' },
            })}
          />
          {errors.price && <span className="error">{errors.price.message}</span>}
        </div>

        {perKgHint(createUnitType, createPriceBase, createPrice) && (
          <div className="field field-full">
            <small className="report-note">{perKgHint(createUnitType, createPriceBase, createPrice)}</small>
          </div>
        )}

        <div className="field">
          <label htmlFor="promoPrice">Precio promocional</label>
          <input
            id="promoPrice"
            type="number"
            step="0.01"
            placeholder="Ej: 1350"
            {...register('promoPrice', { min: { value: 0, message: 'El precio no puede ser negativo' } })}
          />
          {errors.promoPrice && <span className="error">{errors.promoPrice.message}</span>}
        </div>

        <div className="field">
          <label htmlFor="cost">
            Costo
            <RequiredMark />
          </label>
          <input
            id="cost"
            type="number"
            step="0.01"
            placeholder="Ej: 900"
            {...register('cost', {
              required: 'El costo es obligatorio',
              min: { value: 0, message: 'El costo no puede ser negativo' },
            })}
          />
          {errors.cost && <span className="error">{errors.cost.message}</span>}
        </div>

        <div className="field">
          <label htmlFor="vatRate">IVA</label>
          <VatSelect id="vatRate" registration={register('vatRate')} />
        </div>

        <div className="field">
          <label htmlFor="otherTaxes">
            Impuestos internos (%) <small>(opcional)</small>
          </label>
          <input
            id="otherTaxes"
            type="number"
            step="0.01"
            min="0"
            max="100"
            placeholder="Ej: 8"
            {...register('otherTaxes')}
          />
        </div>

        <div className="field field-full">
          <label htmlFor="description">Descripción</label>
          <textarea
            id="description"
            placeholder="Ej: Cerveza artesanal estilo IPA, botella 500ml"
            {...register('description')}
          />
        </div>

        <button type="submit">Agregar producto</button>
        <FormMessage message={msg.at('create')} onClose={msg.clear} />
        <RequiredLegend />
      </form>

      <SearchInput
        id="product-search"
        label="Buscar productos"
        placeholder="Buscar por producto, código, marca, modelo o categoría..."
        value={search}
        onChange={setSearch}
      />

      <FormMessage message={msg.at('list')} />
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Código</th>
              <th>Producto</th>
              <th>Categoría</th>
              <th>Precio</th>
              <th>Precio promo</th>
              <th>Costo</th>
              <th>Stock</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visibleProducts.length === 0 && (
              <tr>
                <td colSpan={8} className="list-search-empty">
                  {search ? 'No hay productos que coincidan con la búsqueda' : 'Todavía no hay productos'}
                </td>
              </tr>
            )}
            {visibleProducts.map((product) => (
              <Fragment key={product.id}>
                <tr>
                  {editingId === product.id ? (
                    <td colSpan={8} className="edit-cell">
                      <form onSubmit={editForm.handleSubmit(onUpdate)} className="inline-edit-form">
                        <div className="field">
                          <label htmlFor={`edit-internalCode-${product.id}`}>
                            Código interno
                            <RequiredMark />
                          </label>
                          <input
                            id={`edit-internalCode-${product.id}`}
                            {...editForm.register('internalCode', { required: 'El código interno es obligatorio' })}
                          />
                          {editErrors.internalCode && <span className="error">{editErrors.internalCode.message}</span>}
                        </div>
                        <div className="field">
                          <label htmlFor={`edit-barcode-${product.id}`}>Código de barras</label>
                          <div className="input-with-action">
                            <input
                              id={`edit-barcode-${product.id}`}
                              placeholder="Escribí o escaneá el código"
                              {...editForm.register('barcode')}
                              onKeyDown={blockEnter}
                            />
                            <button
                              type="button"
                              className="scan-button"
                              title="Escanear con la cámara del celular"
                              onClick={() => setScanTarget('edit')}
                            >
                              Cámara
                            </button>
                          </div>
                          {editErrors.barcode && <span className="error">{editErrors.barcode.message}</span>}
                        </div>
                        <div className="field">
                          <label htmlFor={`edit-name-${product.id}`}>
                            Producto
                            <RequiredMark />
                          </label>
                          <input
                            id={`edit-name-${product.id}`}
                            {...editForm.register('name', { required: 'El nombre es obligatorio' })}
                          />
                          {editErrors.name && <span className="error">{editErrors.name.message}</span>}
                        </div>
                        <div className="field">
                          <label htmlFor={`edit-brand-${product.id}`}>Marca</label>
                          <input id={`edit-brand-${product.id}`} {...editForm.register('brand')} />
                        </div>
                        <div className="field">
                          <label htmlFor={`edit-model-${product.id}`}>Modelo</label>
                          <input id={`edit-model-${product.id}`} {...editForm.register('model')} />
                        </div>
                        <div className="field">
                          <label htmlFor={`edit-categoryId-${product.id}`}>Categoría</label>
                          <select id={`edit-categoryId-${product.id}`} {...editForm.register('categoryId')}>
                            <option value="">Sin categoría</option>
                            {flatCategories.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label htmlFor={`edit-unitType-${product.id}`}>Unidad</label>
                          <select id={`edit-unitType-${product.id}`} {...editForm.register('unitType')}>
                            <option value="unit">Por unidad</option>
                            <option value="weight">Por peso</option>
                          </select>
                        </div>
                        {editUnitType === 'weight' && (
                          <div className="field">
                            <label htmlFor={`edit-scalePlu-${product.id}`}>PLU de balanza</label>
                            <input
                              id={`edit-scalePlu-${product.id}`}
                              type="number"
                              min="1"
                              max="9999"
                              step="1"
                              placeholder="Ej: 417"
                              {...editForm.register('scalePlu')}
                            />
                            {editErrors.scalePlu && <span className="error">{editErrors.scalePlu.message}</span>}
                          </div>
                        )}
                        {editUnitType === 'weight' && (
                          <div className="field">
                            <label htmlFor={`edit-priceBase-${product.id}`}>Cargo precio y costo por</label>
                            <select id={`edit-priceBase-${product.id}`} {...editForm.register('priceBase')}>
                              {PRICE_BASES.map((b) => (
                                <option key={b.value} value={b.value}>
                                  {b.label}
                                </option>
                              ))}
                            </select>
                          </div>
                        )}
                        <div className="field">
                          <label htmlFor={`edit-price-${product.id}`}>
                            Precio{editUnitType === 'weight' ? ' (por la cantidad elegida)' : ''}
                            <RequiredMark />
                          </label>
                          <input
                            id={`edit-price-${product.id}`}
                            type="number"
                            step="0.01"
                            {...editForm.register('price', {
                              required: 'El precio es obligatorio',
                              min: { value: 0, message: 'El precio no puede ser negativo' },
                            })}
                          />
                          {editErrors.price && <span className="error">{editErrors.price.message}</span>}
                        </div>
                        {perKgHint(editUnitType, editPriceBase, editPrice) && (
                          <div className="field field-full">
                            <small className="report-note">{perKgHint(editUnitType, editPriceBase, editPrice)}</small>
                          </div>
                        )}
                        <div className="field">
                          <label htmlFor={`edit-promoPrice-${product.id}`}>Precio promo</label>
                          <input
                            id={`edit-promoPrice-${product.id}`}
                            type="number"
                            step="0.01"
                            {...editForm.register('promoPrice')}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`edit-cost-${product.id}`}>
                            Costo
                            <RequiredMark />
                          </label>
                          <input
                            id={`edit-cost-${product.id}`}
                            type="number"
                            step="0.01"
                            {...editForm.register('cost', {
                              required: 'El costo es obligatorio',
                              min: { value: 0, message: 'El costo no puede ser negativo' },
                            })}
                          />
                          {editErrors.cost && <span className="error">{editErrors.cost.message}</span>}
                        </div>
                        <div className="field">
                          <label htmlFor={`edit-vatRate-${product.id}`}>IVA</label>
                          <VatSelect
                            id={`edit-vatRate-${product.id}`}
                            registration={editForm.register('vatRate')}
                            legacyValue={product.vatRate}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`edit-otherTaxes-${product.id}`}>
                            Impuestos internos (%) <small>(opcional)</small>
                          </label>
                          <input
                            id={`edit-otherTaxes-${product.id}`}
                            type="number"
                            step="0.01"
                            min="0"
                            max="100"
                            placeholder="Ej: 8"
                            {...editForm.register('otherTaxes')}
                          />
                        </div>
                        <div className="field">
                          <label htmlFor={`edit-active-${product.id}`}>Estado</label>
                          <select id={`edit-active-${product.id}`} {...editForm.register('active')}>
                            <option value="true">Activo</option>
                            <option value="false">Inactivo</option>
                          </select>
                        </div>
                        <div className="field field-full">
                          <label htmlFor={`edit-description-${product.id}`}>Descripción</label>
                          <textarea id={`edit-description-${product.id}`} {...editForm.register('description')} />
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
                      <td data-label="Código">{product.internalCode}</td>
                      <td data-label="Producto">
                        {product.name}
                        {product.scalePlu ? <small> · PLU {product.scalePlu}</small> : null}
                      </td>
                      <td data-label="Categoría">{categoryName(product.categoryId)}</td>
                      <td data-label="Precio">
                        ${Number(product.price).toFixed(2)}
                        {perKg(product.unitType)}
                      </td>
                      <td data-label="Precio promo">
                        {product.promoPrice
                          ? `$${Number(product.promoPrice).toFixed(2)}${perKg(product.unitType)}`
                          : '—'}
                      </td>
                      <td data-label="Costo">
                        ${Number(product.cost).toFixed(2)}
                        {perKg(product.unitType)}
                      </td>
                      <td data-label="Stock">{formatQuantity(product.stock, product.unitType)}</td>
                      <td data-label="Acciones">
                        <button onClick={() => startEdit(product)}>Editar</button>
                        <button onClick={() => onDelete(product.id)}>Eliminar</button>
                        <button onClick={() => setStockPanelId(stockPanelId === product.id ? null : product.id)}>
                          {stockPanelId === product.id ? 'Cerrar stock' : 'Stock'}
                        </button>
                        <FormMessage message={msg.at(product.id)} onClose={msg.clear} />
                      </td>
                    </>
                  )}
                </tr>
                {stockPanelId === product.id && (
                  <tr>
                    <td colSpan={8} className="edit-cell">
                      <StockMovementPanel product={product} onStockChange={reload} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      {scanTarget && <BarcodeScanner onDetected={handleScanned} onClose={() => setScanTarget(null)} />}
    </div>
  );
};

export default Products;
