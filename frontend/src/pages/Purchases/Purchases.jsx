import { useEffect, useRef, useState } from 'react';
import { useDialog } from '../../context/DialogContext.jsx';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { getPurchases, createPurchase, cancelPurchase } from '../../api/purchases.api.js';
import { getSuppliers, createSupplier } from '../../api/suppliers.api.js';
import { getProducts, createProduct } from '../../api/products.api.js';
import FormMessage from '../../components/common/FormMessage.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { serverMessage } from '../../utils/serverErrors.js';
import { useAuth } from '../../context/AuthContext.jsx';
import Spinner from '../../components/common/Spinner.jsx';
import DateRangeFilter from '../../components/common/DateRangeFilter.jsx';
import { presetRange } from '../../utils/reportFormat.js';
import ScanBar from '../../components/common/ScanBar.jsx';
import SearchSelect from '../../components/common/SearchSelect.jsx';
import VatSelect from '../../components/common/VatSelect.jsx';
import { toPercentOrNull, vatToFormValue, formatRate, PURCHASE_VAT_OPTIONS } from '../../utils/taxes.js';
import { purchaseTotals } from '../../utils/purchaseTotals.js';
import { newRequestId } from '../../utils/requestId.js';
import { formatQuantity, quantityStep, quantityMin, toKg } from '../../utils/quantity.js';
import { RequiredMark, RequiredLegend } from '../../components/common/Required.jsx';
import { isVariantGroup } from '../../utils/variants.js';

const NEW_SUPPLIER = '__new_supplier__';
const NEW_PRODUCT = '__new_product__';
const NEW_SUPPLY = '__new_supply__';
// Renglón con un producto o un insumo que se crea junto con la compra
const isNewRow = (productId) => productId === NEW_PRODUCT || productId === NEW_SUPPLY;

const emptyItem = () => ({
  productId: '',
  quantity: 1,
  qtyUnit: 'kg',
  unitCost: 0,
  vatRate: '21',
  newProduct: { internalCode: '', barcode: '', name: '', price: '', vatRate: '21', otherTaxes: '', unitType: 'unit' },
});

// Servicio o gasto (alquiler, luz, flete): concepto libre, sin producto ni stock
const emptyExpense = () => ({ description: '', quantity: 1, unitCost: '', vatRate: '21' });

const emptyForm = () => ({
  supplierId: '',
  invoiceNumber: '',
  paymentCondition: 'cash',
  newSupplier: { name: '', cuit: '', phone: '', email: '' },
  items: [emptyItem()],
  expenses: [],
});

const Purchases = () => {
  const [purchases, setPurchases] = useState([]);
  // Período de la lista: por defecto los últimos 30 días (no se cargan todas las de la historia)
  const [range, setRange] = useState(() => presetRange('last30'));
  const [purchasesLoading, setPurchasesLoading] = useState(false);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const msg = useMessage();
  const dialog = useDialog();
  const { role } = useAuth();
  const canManageData = role === 'admin' || role === 'editor';

  const {
    register,
    control,
    handleSubmit,
    reset,
    watch,
    setValue,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: emptyForm(),
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const expenseArray = useFieldArray({ control, name: 'expenses' });
  const watchedItems = watch('items');
  const watchedExpenses = watch('expenses');
  // Tiene que quedar al menos un renglón: de producto o de servicio
  const totalRows = fields.length + expenseArray.fields.length;
  const selectedSupplierId = watch('supplierId');
  const isNewSupplier = selectedSupplierId === NEW_SUPPLIER;

  const loadAll = async () => {
    setLoading(true);
    try {
      const [purchasesRes, suppliersRes, productsRes] = await Promise.all([
        getPurchases(range),
        getSuppliers(),
        getProducts('all'),
      ]);
      setPurchases(purchasesRes.data);
      setSuppliers(suppliersRes.data);
      setProducts(productsRes.data);
    } catch (err) {
      msg.error('No se pudo cargar la información. Recargá la página.', 'page');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, []);

  const loadPurchases = async (nextRange) => {
    setPurchasesLoading(true);
    try {
      const { data } = await getPurchases(nextRange);
      setPurchases(data);
      setRange(nextRange);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudieron cargar las compras.'), 'page');
    } finally {
      setPurchasesLoading(false);
    }
  };

  // IVA del renglón: el elegido en la fila o, si el producto es nuevo, el que se le carga al producto
  const rowVat = (item) => (isNewRow(item.productId) ? item.newProduct?.vatRate : item.vatRate);
  const totals = purchaseTotals([
    ...(watchedItems || []).map((item) => ({
      quantity: toKg(item.quantity, item.qtyUnit),
      unitCost: Number(item.unitCost) || 0,
      vatRate: Number(rowVat(item)) || 0,
    })),
    ...(watchedExpenses || []).map((expense) => ({
      quantity: Number(expense.quantity) || 0,
      unitCost: Number(expense.unitCost) || 0,
      vatRate: Number(expense.vatRate) || 0,
    })),
  ]);

  // Código leído con el lector USB o con la cámara
  const handleScan = async (rawCode) => {
    const code = String(rawCode || '').trim();
    if (!code) return;

    const items = watchedItems || [];
    const emptyIndex = items.findIndex((it) => !it.productId);
    const product = products.find(
      (p) => !p.isCombo && !isVariantGroup(p) && (p.barcode === code || p.internalCode === code),
    );

    if (product) {
      const existing = items.findIndex((it) => it.productId === product.id);
      if (existing >= 0) {
        setValue(`items.${existing}.quantity`, (Number(items[existing].quantity) || 0) + 1);
      } else if (emptyIndex >= 0) {
        setValue(`items.${emptyIndex}.productId`, product.id);
        setValue(`items.${emptyIndex}.unitCost`, Number(product.cost) || 0);
        setValue(`items.${emptyIndex}.vatRate`, vatToFormValue(product.vatRate));
      } else {
        append({
          ...emptyItem(),
          productId: product.id,
          unitCost: Number(product.cost) || 0,
          vatRate: vatToFormValue(product.vatRate),
        });
      }
      msg.success(`${product.name} agregado`, 'scan');
      return;
    }

    if (!canManageData) {
      msg.error(`No hay ningún producto con el código ${code}.`, 'scan');
      return;
    }
    if (
      !(await dialog.confirm({
        title: 'Código no registrado.',
        message: `El código ${code} no está registrado. ¿Crear un producto nuevo con ese código?`,
        confirmLabel: 'Crear producto',
      }))
    ) {
      return;
    }
    if (emptyIndex >= 0) {
      setValue(`items.${emptyIndex}.productId`, NEW_PRODUCT);
      setValue(`items.${emptyIndex}.newProduct.barcode`, code);
    } else {
      append({
        ...emptyItem(),
        productId: NEW_PRODUCT,
        newProduct: { ...emptyItem().newProduct, barcode: code },
      });
    }
  };

  // Evita el doble envío: el botón se deshabilita mientras se envía (isSubmitting) y, por si dos
  // clics llegan antes de que se redibuje, sendingRef corta el segundo. requestIdRef identifica el
  // envío: si el servidor ya lo recibió, devuelve la misma compra en lugar de crear otra.
  const sendingRef = useRef(false);
  const requestIdRef = useRef(newRequestId());
  const onSubmit = async (formData) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
      await submitPurchase(formData);
    } finally {
      sendingRef.current = false;
    }
  };

  const submitPurchase = async (formData) => {
    msg.clear();
    let payload = null;
    // Proveedor y productos nuevos se crean antes de la compra (son pedidos aparte). Si la compra
    // después falla, se avisa cuáles ya quedaron creados para no cargarlos de nuevo.
    const created = [];
    const finish = () => {
      requestIdRef.current = newRequestId();
      msg.success(formData.items?.length ? 'Compra registrada, stock actualizado.' : 'Compra registrada.');
      reset(emptyForm());
      loadAll();
    };
    try {
      // Datos del proveedor y de los productos nuevos: cada error va debajo de su campo
      let missing = false;
      if (isNewSupplier && !formData.newSupplier.name) {
        setError('newSupplier.name', { type: 'manual', message: 'Cargá el nombre del proveedor.' });
        missing = true;
      }

      formData.items.forEach((item, i) => {
        if (!isNewRow(item.productId)) return;
        const supply = item.productId === NEW_SUPPLY;
        const np = item.newProduct || {};
        if (!np.internalCode) {
          setError(`items.${i}.newProduct.internalCode`, { type: 'manual', message: 'Cargá el código interno.' });
          missing = true;
        }
        if (!np.name) {
          setError(`items.${i}.newProduct.name`, {
            type: 'manual',
            message: supply ? 'Cargá el nombre del insumo.' : 'Cargá el nombre del producto.',
          });
          missing = true;
        }
        if (!supply && !(Number(np.price) > 0)) {
          setError(`items.${i}.newProduct.price`, { type: 'manual', message: 'Cargá el precio de venta.' });
          missing = true;
        }
      });
      if (missing) return;

      let supplierId = formData.supplierId;
      if (isNewSupplier) {
        const { name, cuit, phone, email } = formData.newSupplier;
        const { data: newSupplier } = await createSupplier({
          name,
          cuit: cuit || null,
          phone: phone || null,
          email: email || null,
        });
        supplierId = newSupplier.id;
        created.push(`el proveedor ${newSupplier.name}`);
        setSuppliers((prev) => [...prev, newSupplier]);
        setValue('supplierId', newSupplier.id);
      }

      const payloadItems = [];
      for (let i = 0; i < formData.items.length; i += 1) {
        const item = formData.items[i];
        let productId = item.productId;

        if (isNewRow(productId)) {
          const np = item.newProduct;
          const supply = productId === NEW_SUPPLY;
          // Un insumo se crea sin precio de venta ni impuestos internos (no se vende)
          const { data: createdProduct } = await createProduct({
            internalCode: np.internalCode,
            barcode: np.barcode || null,
            name: np.name,
            price: supply ? 0 : Number(np.price),
            cost: Number(item.unitCost) || 0,
            vatRate: np.vatRate === '' || np.vatRate === undefined ? 21 : Number(np.vatRate),
            otherTaxes: supply ? null : toPercentOrNull(np.otherTaxes),
            unitType: np.unitType || 'unit',
            ...(supply ? { isSupply: true } : {}),
          });
          productId = createdProduct.id;
          created.push(`${supply ? 'el insumo' : 'el producto'} ${createdProduct.name}`);
          setProducts((prev) => [...prev, createdProduct]);
          setValue(`items.${i}.productId`, createdProduct.id);
        }

        payloadItems.push({
          productId,
          quantity: toKg(item.quantity, item.qtyUnit),
          unitCost: Number(item.unitCost),
          vatRate: Number(rowVat(item)) || 0,
        });
      }

      payload = {
        supplierId,
        invoiceNumber: formData.invoiceNumber || null,
        paymentCondition: formData.paymentCondition === 'account' ? 'account' : 'cash',
        items: payloadItems,
        expenses: (formData.expenses || []).map((expense) => ({
          description: expense.description.trim(),
          quantity: Number(expense.quantity),
          unitCost: Number(expense.unitCost),
          vatRate: Number(expense.vatRate),
        })),
        requestId: requestIdRef.current,
      };
      await createPurchase(payload);
      finish();
    } catch (err) {
      // La misma factura del mismo proveedor ya estaba cargada: se pregunta antes de sumar el stock otra vez
      if (payload && err.response?.data?.code === 'DUPLICATE_INVOICE') {
        if (
          !(await dialog.confirm({
            title: 'Factura ya cargada',
            message: `${err.response.data.message}\n\n¿Cargarla igual?`,
            confirmLabel: 'Cargarla igual',
            cancelLabel: 'No cargar',
          }))
        ) {
          msg.error('No se cargó la compra: la factura ya estaba registrada.');
          return;
        }
        try {
          await createPurchase({ ...payload, confirmDuplicateInvoice: true });
          finish();
        } catch (retryErr) {
          msg.error(serverMessage(retryErr, 'Error al registrar la compra.'));
        }
        return;
      }
      // "Artículo 2: ..." se muestra en ese renglón; el resto, junto al botón
      const text = serverMessage(err, 'Error al registrar la compra.');
      if (created.length) {
        msg.error(
          `${text} La compra no se registró, pero ya quedaron creados ${created.join(' y ')}: ` +
            'están elegidos en el formulario, no hace falta cargarlos de nuevo.',
        );
        return;
      }
      const row = /^Artículo (\d+):\s*/.exec(text);
      if (row) msg.error(text.slice(row[0].length), `row-${Number(row[1]) - 1}`);
      else msg.error(text);
    }
  };

  const supplierName = (id) => suppliers.find((s) => s.id === id)?.name || '—';

  // Anular una compra cargada por error: resta del stock lo que había sumado
  const [cancellingId, setCancellingId] = useState(null);
  const handleCancel = async (purchase) => {
    const name = purchase.Supplier?.name || supplierName(purchase.supplierId);
    const reason = await dialog.prompt({
      title: 'Anular compra',
      message:
        `Vas a anular la compra a ${name}${purchase.invoiceNumber ? ` (factura ${purchase.invoiceNumber})` : ''} ` +
        `por $${Number(purchase.total).toFixed(2)}.\n` +
        'Se resta del stock lo que había sumado. Si fue un error de carga, después cargala de nuevo bien.',
      label: 'Motivo (opcional)',
      confirmLabel: 'Anular compra',
      cancelLabel: 'Volver',
      danger: true,
    });
    if (reason === null) return;

    setCancellingId(purchase.id);
    try {
      await cancelPurchase(purchase.id, reason);
      await loadAll();
      msg.success('Compra anulada, stock descontado.', purchase.id);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo anular la compra.'), purchase.id);
    } finally {
      setCancellingId(null);
    }
  };

  // Los proveedores inactivos no se ofrecen (salvo el que ya está elegido)
  const supplierOptions = suppliers
    .filter((s) => s.active !== false || s.id === selectedSupplierId)
    .map((s) => ({
      value: s.id,
      label: s.name,
      detail: s.cuit ? `CUIT ${s.cuit}` : '',
      keywords: [s.cuit, s.email],
    }));
  const productOptions = products
    .filter((p) => !p.isCombo && !isVariantGroup(p))
    .map((p) => ({
      value: p.id,
      label: p.isSupply ? `${p.name} (insumo)` : p.name,
      detail: [p.internalCode && `Cód. ${p.internalCode}`, `Stock: ${formatQuantity(p.stock, p.unitType)}`]
        .filter(Boolean)
        .join(' · '),
      keywords: [p.internalCode, p.barcode, p.brand, p.model],
    }));

  if (loading) return <Spinner label="Cargando compras..." />;

  return (
    <div className="purchases-page">
      <h1>Compras a proveedores</h1>
      <FormMessage message={msg.at('page')} onClose={msg.clear} />

      <form onSubmit={handleSubmit(onSubmit)} className="purchase-form">
        <div className="field">
          <label htmlFor="supplierId">
            Proveedor
            <RequiredMark />
          </label>
          <Controller
            name="supplierId"
            control={control}
            rules={{ required: 'Elegí un proveedor' }}
            render={({ field }) => (
              <SearchSelect
                id="supplierId"
                title="Buscar proveedor"
                searchPlaceholder="Nombre o CUIT..."
                placeholder="Elegí un proveedor..."
                emptyText="No hay proveedores que coincidan"
                value={field.value}
                onChange={field.onChange}
                options={supplierOptions}
                extraOptions={canManageData ? [{ value: NEW_SUPPLIER, label: '+ Nuevo proveedor...' }] : []}
                hasError={Boolean(errors.supplierId)}
              />
            )}
          />
          {errors.supplierId && <span className="error">{errors.supplierId.message}</span>}
        </div>

        {isNewSupplier && (
          <div className="inline-customer-form">
            <div className="field">
              <label htmlFor="newSupplierName">
                Nombre
                <RequiredMark />
              </label>
              <input id="newSupplierName" placeholder="Ej: Distribuidora Norte SRL" {...register('newSupplier.name')} />
              {errors.newSupplier?.name && <span className="error">{errors.newSupplier?.name.message}</span>}
            </div>
            <div className="field">
              <label htmlFor="newSupplierCuit">CUIT</label>
              <input id="newSupplierCuit" placeholder="Ej: 30-12345678-9" {...register('newSupplier.cuit')} />
            </div>
            <div className="field">
              <label htmlFor="newSupplierPhone">Teléfono</label>
              <input id="newSupplierPhone" placeholder="Ej: 3492 456789" {...register('newSupplier.phone')} />
            </div>
            <div className="field">
              <label htmlFor="newSupplierEmail">Email</label>
              <input
                id="newSupplierEmail"
                type="email"
                placeholder="Ej: ventas@distribuidora.com"
                {...register('newSupplier.email')}
              />
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="invoiceNumber">N° de factura (opcional)</label>
          <input id="invoiceNumber" placeholder="Ej: 0001-00001234" {...register('invoiceNumber')} />
        </div>

        <div className="field">
          <label htmlFor="paymentCondition">Condición</label>
          <select id="paymentCondition" {...register('paymentCondition')}>
            <option value="cash">Contado</option>
            <option value="account">Cuenta corriente</option>
          </select>
        </div>

        <ScanBar onScan={handleScan} />
        <FormMessage message={msg.at('scan')} onClose={msg.clear} />

        <div className="purchase-items">
          {fields.map((field, index) => {
            const rowProductId = watchedItems?.[index]?.productId;
            const isNewProduct = isNewRow(rowProductId);
            const isNewSupply = rowProductId === NEW_SUPPLY;
            const rowProduct = products.find((p) => p.id === rowProductId);
            const rowUnitType = isNewProduct ? watchedItems?.[index]?.newProduct?.unitType : rowProduct?.unitType;
            const rowQtyUnit = rowUnitType === 'weight' ? watchedItems?.[index]?.qtyUnit || 'kg' : 'kg';
            const rowQuantity = toKg(watchedItems?.[index]?.quantity, rowQtyUnit);
            const rowCost = Number(watchedItems?.[index]?.unitCost) || 0;

            return (
              <div key={field.id} className="purchase-item-row">
                <div className="field">
                  <label htmlFor={`item-product-${index}`}>
                    Producto
                    <RequiredMark />
                  </label>
                  <Controller
                    name={`items.${index}.productId`}
                    control={control}
                    rules={{ required: 'Elegí un producto' }}
                    render={({ field }) => (
                      <SearchSelect
                        id={`item-product-${index}`}
                        title="Buscar producto"
                        searchPlaceholder="Nombre, código, marca o modelo..."
                        placeholder="Producto..."
                        emptyText="No hay productos que coincidan"
                        value={field.value}
                        onChange={(value) => {
                          field.onChange(value);
                          // El IVA de la fila arranca con el del producto (se puede cambiar)
                          const chosen = products.find((p) => p.id === value);
                          if (chosen) setValue(`items.${index}.vatRate`, vatToFormValue(chosen.vatRate));
                        }}
                        options={productOptions}
                        extraOptions={
                          canManageData
                            ? [
                                { value: NEW_PRODUCT, label: '+ Nuevo producto...' },
                                { value: NEW_SUPPLY, label: '+ Nuevo insumo...' },
                              ]
                            : []
                        }
                        hasError={Boolean(errors.items?.[index]?.productId)}
                      />
                    )}
                  />
                  {errors.items?.[index]?.productId && (
                    <span className="error">{errors.items?.[index]?.productId.message}</span>
                  )}
                </div>
                <div className="field">
                  <label htmlFor={`item-quantity-${index}`}>
                    Cantidad
                    <RequiredMark />
                  </label>
                  <div className={rowUnitType === 'weight' ? 'input-with-action' : undefined}>
                    <input
                      id={`item-quantity-${index}`}
                      type="number"
                      step={rowQtyUnit === 'g' ? '1' : quantityStep(rowUnitType)}
                      placeholder={
                        rowUnitType === 'weight' ? (rowQtyUnit === 'g' ? 'Ej: 500' : 'Ej: 10,500') : 'Ej: 10'
                      }
                      {...register(`items.${index}.quantity`, {
                        required: 'Cargá la cantidad',
                        min: {
                          value: rowQtyUnit === 'g' ? 1 : quantityMin(rowUnitType),
                          message: 'La cantidad tiene que ser mayor a 0',
                        },
                      })}
                    />
                    {rowUnitType === 'weight' && (
                      <select aria-label="Unidad de la cantidad" {...register(`items.${index}.qtyUnit`)}>
                        <option value="kg">kg</option>
                        <option value="g">g</option>
                      </select>
                    )}
                  </div>
                  {errors.items?.[index]?.quantity && (
                    <span className="error">{errors.items?.[index]?.quantity.message}</span>
                  )}
                </div>
                <div className="field">
                  <label htmlFor={`item-unitCost-${index}`}>
                    {rowUnitType === 'weight' ? 'Costo por kg sin IVA' : 'Costo unitario sin IVA'}
                    <RequiredMark />
                  </label>
                  <input
                    id={`item-unitCost-${index}`}
                    type="number"
                    step="0.01"
                    placeholder="Ej: 850"
                    {...register(`items.${index}.unitCost`, {
                      required: 'Cargá el costo',
                      min: { value: 0, message: 'El costo no puede ser negativo.' },
                    })}
                  />
                  {errors.items?.[index]?.unitCost && (
                    <span className="error">{errors.items?.[index]?.unitCost.message}</span>
                  )}
                </div>
                {!isNewProduct && (
                  <div className="field">
                    <label htmlFor={`item-vat-${index}`}>IVA</label>
                    <VatSelect
                      id={`item-vat-${index}`}
                      registration={register(`items.${index}.vatRate`)}
                      legacyValue={rowProduct?.vatRate}
                      options={PURCHASE_VAT_OPTIONS}
                    />
                  </div>
                )}
                <div className="field item-remove-field">
                  <label aria-hidden="true">&nbsp;</label>
                  <button
                    type="button"
                    onClick={() => remove(index)}
                    disabled={totalRows === 1}
                    style={{ visibility: totalRows === 1 ? 'hidden' : 'visible' }}
                  >
                    Quitar
                  </button>
                </div>

                {rowUnitType === 'weight' && rowQuantity > 0 && (
                  <div className="field field-full">
                    <small className="report-note">
                      {formatQuantity(rowQuantity, 'weight')} × ${rowCost.toFixed(2)} por kg = $
                      {(Math.round(rowQuantity * rowCost * 100) / 100).toFixed(2)}
                    </small>
                  </div>
                )}

                {isNewProduct && (
                  <div className="inline-customer-form field-full">
                    <div className="field">
                      <label htmlFor={`new-product-code-${index}`}>
                        Código interno
                        <RequiredMark />
                      </label>
                      <input
                        id={`new-product-code-${index}`}
                        placeholder="Ej: P001"
                        {...register(`items.${index}.newProduct.internalCode`)}
                      />
                      {errors.items?.[index]?.newProduct?.internalCode && (
                        <span className="error">{errors.items?.[index]?.newProduct?.internalCode.message}</span>
                      )}
                    </div>
                    <div className="field">
                      <label htmlFor={`new-product-barcode-${index}`}>Código de barras</label>
                      <input id={`new-product-barcode-${index}`} {...register(`items.${index}.newProduct.barcode`)} />
                    </div>
                    <div className="field">
                      <label htmlFor={`new-product-name-${index}`}>
                        {isNewSupply ? 'Insumo' : 'Producto'}
                        <RequiredMark />
                      </label>
                      <input
                        id={`new-product-name-${index}`}
                        placeholder={isNewSupply ? 'Ej: Bolsas camiseta 40x50' : 'Ej: Cerveza IPA 500ml'}
                        {...register(`items.${index}.newProduct.name`)}
                      />
                      {errors.items?.[index]?.newProduct?.name && (
                        <span className="error">{errors.items?.[index]?.newProduct?.name.message}</span>
                      )}
                    </div>
                    {!isNewSupply && (
                      <div className="field">
                        <label htmlFor={`new-product-price-${index}`}>
                          {rowUnitType === 'weight' ? 'Precio de venta por kg' : 'Precio de venta'}
                          <RequiredMark />
                        </label>
                        <input
                          id={`new-product-price-${index}`}
                          type="number"
                          step="0.01"
                          placeholder="Ej: 1500"
                          {...register(`items.${index}.newProduct.price`)}
                        />
                        {errors.items?.[index]?.newProduct?.price && (
                          <span className="error">{errors.items?.[index]?.newProduct?.price.message}</span>
                        )}
                      </div>
                    )}
                    <div className="field">
                      <label htmlFor={`new-product-vat-${index}`}>IVA</label>
                      <VatSelect
                        id={`new-product-vat-${index}`}
                        registration={register(`items.${index}.newProduct.vatRate`)}
                      />
                    </div>
                    {!isNewSupply && (
                      <div className="field">
                        <label htmlFor={`new-product-internal-${index}`}>
                          Impuestos internos (%) <small>(opcional)</small>
                        </label>
                        <input
                          id={`new-product-internal-${index}`}
                          type="number"
                          step="0.01"
                          min="0"
                          max="100"
                          placeholder="Ej: 8"
                          {...register(`items.${index}.newProduct.otherTaxes`)}
                        />
                      </div>
                    )}
                    <div className="field">
                      <label htmlFor={`new-product-unit-${index}`}>
                        {isNewSupply ? 'Se maneja por' : 'Unidad de comercialización'}
                      </label>
                      <select id={`new-product-unit-${index}`} {...register(`items.${index}.newProduct.unitType`)}>
                        <option value="unit">Por unidad</option>
                        <option value="weight">Por peso</option>
                      </select>
                    </div>
                    <div className="field field-full stock-warning">
                      <span>
                        {isNewSupply ? 'Se crea en Insumos (no se vende). ' : ''}
                        El costo {isNewSupply ? 'del insumo' : 'del producto'} será el "Costo unitario sin IVA" de esta
                        fila y el IVA de la compra, el que elijas acá. Se crea con stock 0 y la compra le suma{' '}
                        {formatQuantity(rowQuantity, rowUnitType)}.
                      </span>
                    </div>
                  </div>
                )}

                {msg.at(`row-${index}`) && (
                  <div className="field field-full">
                    <FormMessage message={msg.at(`row-${index}`)} onClose={msg.clear} />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {expenseArray.fields.length > 0 && (
          <div className="purchase-items purchase-expenses">
            <h3 className="purchase-section-title">Servicios y gastos</h3>
            {expenseArray.fields.map((field, index) => (
              <div key={field.id} className="purchase-item-row">
                <div className="field">
                  <label htmlFor={`expense-description-${index}`}>
                    Concepto
                    <RequiredMark />
                  </label>
                  <input
                    id={`expense-description-${index}`}
                    maxLength={150}
                    placeholder="Ej: Alquiler de noviembre, flete, luz"
                    {...register(`expenses.${index}.description`, {
                      validate: (value) => Boolean(value?.trim()) || 'Cargá el concepto',
                    })}
                  />
                  {errors.expenses?.[index]?.description && (
                    <span className="error">{errors.expenses[index].description.message}</span>
                  )}
                </div>
                <div className="field">
                  <label htmlFor={`expense-quantity-${index}`}>
                    Cantidad
                    <RequiredMark />
                  </label>
                  <input
                    id={`expense-quantity-${index}`}
                    type="number"
                    step="0.001"
                    {...register(`expenses.${index}.quantity`, {
                      required: 'Cargá la cantidad',
                      min: { value: 0.001, message: 'La cantidad tiene que ser mayor a 0' },
                    })}
                  />
                  {errors.expenses?.[index]?.quantity && (
                    <span className="error">{errors.expenses[index].quantity.message}</span>
                  )}
                </div>
                <div className="field">
                  <label htmlFor={`expense-cost-${index}`}>
                    Importe sin IVA
                    <RequiredMark />
                  </label>
                  <input
                    id={`expense-cost-${index}`}
                    type="number"
                    step="0.01"
                    placeholder="Ej: 150000"
                    {...register(`expenses.${index}.unitCost`, {
                      required: 'Cargá el importe',
                      min: { value: 0, message: 'El importe no puede ser negativo.' },
                    })}
                  />
                  {errors.expenses?.[index]?.unitCost && (
                    <span className="error">{errors.expenses[index].unitCost.message}</span>
                  )}
                </div>
                <div className="field">
                  <label htmlFor={`expense-vat-${index}`}>IVA</label>
                  <VatSelect
                    id={`expense-vat-${index}`}
                    registration={register(`expenses.${index}.vatRate`)}
                    options={PURCHASE_VAT_OPTIONS}
                  />
                </div>
                <div className="field item-remove-field">
                  <label aria-hidden="true">&nbsp;</label>
                  <button
                    type="button"
                    onClick={() => expenseArray.remove(index)}
                    disabled={totalRows === 1}
                    style={{ visibility: totalRows === 1 ? 'hidden' : 'visible' }}
                  >
                    Quitar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="purchase-add-buttons">
          <button type="button" onClick={() => append(emptyItem())}>
            + Agregar producto o insumo
          </button>
          <button type="button" onClick={() => expenseArray.append(emptyExpense())}>
            + Agregar servicio o gasto
          </button>
        </div>

        <div className="purchase-total">
          <span>Neto: ${totals.subtotal.toFixed(2)}</span>
          {totals.byRate
            .filter((r) => r.rate > 0)
            .map((r) => (
              <span key={r.rate}>
                IVA {formatRate(r.rate)}: ${r.vat.toFixed(2)}
              </span>
            ))}
          <strong>Total: ${totals.total.toFixed(2)}</strong>
        </div>

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Registrando compra…' : 'Registrar compra'}
        </button>
        <FormMessage message={msg.at()} onClose={msg.clear} />
        <RequiredLegend />
      </form>

      <DateRangeFilter value={range} loading={purchasesLoading} label="Compras" onChange={loadPurchases} />
      <p className="list-range-note">
        {purchases.length} {purchases.length === 1 ? 'compra' : 'compras'} del{' '}
        {new Date(`${range.from}T12:00:00`).toLocaleDateString('es-AR')} al{' '}
        {new Date(`${range.to}T12:00:00`).toLocaleDateString('es-AR')}
      </p>

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Proveedor</th>
              <th>Factura</th>
              <th>Artículos</th>
              <th>Total</th>
              {canManageData && <th>Acciones</th>}
            </tr>
          </thead>
          <tbody>
            {purchases.map((purchase) => {
              const cancelled = purchase.status === 'cancelled';
              return (
                <tr key={purchase.id} className={cancelled ? 'order-cancelled' : ''}>
                  <td data-label="Fecha">
                    {new Date(purchase.date).toLocaleDateString('es-AR')}
                    {purchase.createdByName && <small className="row-author">por {purchase.createdByName}</small>}
                  </td>
                  <td data-label="Proveedor">
                    {purchase.Supplier?.name || supplierName(purchase.supplierId)}
                    {cancelled && (
                      <span className="badge-cancelled" title={purchase.cancelReason || undefined}>
                        Anulada
                      </span>
                    )}
                  </td>
                  <td data-label="Factura">
                    {purchase.invoiceNumber || '—'}
                    {purchase.paymentCondition === 'account' && <small className="row-author">Cuenta corriente</small>}
                  </td>
                  <td data-label="Artículos">
                    {[
                      ...(purchase.items || []).map(
                        (i) => `${i.Product?.name} x${formatQuantity(i.quantity, i.Product?.unitType)}`,
                      ),
                      ...(purchase.expenses || []).map((e) =>
                        Number(e.quantity) === 1 ? e.description : `${e.description} x${Number(e.quantity)}`,
                      ),
                    ].join(', ')}
                  </td>
                  <td data-label="Total">
                    <span className="amount">${Number(purchase.total).toFixed(2)}</span>
                    {purchase.vatAmount != null && Number(purchase.vatAmount) > 0 && (
                      <small className="row-author">IVA ${Number(purchase.vatAmount).toFixed(2)}</small>
                    )}
                  </td>
                  {canManageData && (
                    <td data-label="Acciones">
                      {!cancelled && (
                        <button
                          type="button"
                          className="btn-danger"
                          disabled={cancellingId === purchase.id}
                          onClick={() => handleCancel(purchase)}
                        >
                          {cancellingId === purchase.id ? 'Anulando…' : 'Anular'}
                        </button>
                      )}
                      <FormMessage message={msg.at(purchase.id)} onClose={msg.clear} />
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Purchases;
