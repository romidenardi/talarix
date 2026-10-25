import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { getOrders, createOrder, cancelOrder, approveOrder } from '../../api/orders.api.js';
import ApprovalDialog from './ApprovalDialog.jsx';
import { orderNumberLabel } from '../../utils/orderNumber.js';
import { getCustomers, createCustomer } from '../../api/customers.api.js';
import { getPayments } from '../../api/payments.api.js';
import { getProducts, createProduct } from '../../api/products.api.js';
import { getScaleConfig } from '../../api/scale.api.js';
import { newRequestId } from '../../utils/requestId.js';
import FormMessage from '../../components/common/FormMessage.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { serverMessage } from '../../utils/serverErrors.js';
import { useAuth } from '../../context/AuthContext.jsx';
import Spinner from '../../components/common/Spinner.jsx';
import ScanBar from '../../components/common/ScanBar.jsx';
import SearchSelect from '../../components/common/SearchSelect.jsx';
import VatSelect from '../../components/common/VatSelect.jsx';
import { splitPrice, splitLineParts, toPercentOrNull } from '../../utils/taxes.js';
import { parseScaleCode, lineFromLabel, resolveScaleConfig } from '../../utils/scale.js';
import { RequiredMark, RequiredLegend } from '../../components/common/Required.jsx';
import {
  formatQuantity, quantityStep, quantityMin, round3, toKg,
} from '../../utils/quantity.js';

const NEW_CUSTOMER = '__new__';
const NEW_PRODUCT = '__new_product__';
const FISCAL_CONDITIONS = ['Consumidor Final', 'Responsable Inscripto', 'Monotributista', 'Exento'];
const FISCAL_CONDITIONS_WITH_VAT_BREAKDOWN = ['Responsable Inscripto'];

// El precio se guarda con centavos: se redondea igual que en el servidor (services/orderPricing.js)
const cents = (value) => Math.round((Number(value) || 0) * 100) / 100;

// Precio que el operador puede usar sin autorización: el de lista o el promocional del producto.
// Es la misma regla que aplica el servidor (services/orderApproval.service.js).
const samePrice = (a, b) => Math.abs(Number(a) - Number(b)) < 0.005;
const isListPrice = (product, unitPrice) =>
  samePrice(unitPrice, product.price)
  || (product.promoPrice !== null && product.promoPrice !== undefined && samePrice(unitPrice, product.promoPrice));

const emptyItem = () => ({
  productId: '',
  quantity: 1,
  qtyUnit: 'kg',
  unitPrice: 0,
  addStock: false,
  newProduct: { internalCode: '', barcode: '', name: '', cost: '', vatRate: '21', otherTaxes: '', unitType: 'unit' },
});

const Orders = () => {
  const [orders, setOrders] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [payments, setPayments] = useState([]);
  const [products, setProducts] = useState([]);
  const [scaleConfig, setScaleConfig] = useState(resolveScaleConfig(null));
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState(null);
  const msg = useMessage();
  const { role } = useAuth();
  const canManageData = role === 'admin' || role === 'editor';
  // Operador: descuentos y precios fuera de lista necesitan la autorización de un admin o editor
  const needsApprovalForChanges = !canManageData;
  const [approval, setApproval] = useState(null); // { formData, summary, notice }
  const approvalTokenRef = useRef(null);

  const {
    register, control, handleSubmit, reset, watch, setValue, setError, formState: { errors, isSubmitting },
  } = useForm({
    defaultValues: {
      customerId: '',
      paymentId: '',
      installmentPlanId: '',
      discountPercent: 0,
      discountAmount: 0,
      notes: '',
      newCustomer: { firstName: '', lastName: '', businessName: '', fiscalCondition: '' },
      items: [emptyItem()],
    },
  });

  const { fields, append, remove } = useFieldArray({ control, name: 'items' });
  const watchedItems = watch('items');
  const selectedCustomerId = watch('customerId');
  const isNewCustomer = selectedCustomerId === NEW_CUSTOMER;
  const newCustomerFiscalCondition = watch('newCustomer.fiscalCondition');
  const selectedPaymentId = watch('paymentId');
  const selectedInstallmentPlanId = watch('installmentPlanId');
  const watchedDiscountPercent = watch('discountPercent');
  const watchedDiscountAmount = watch('discountAmount');

  const loadAll = async () => {
    setLoading(true);
    try {
      const [ordersRes, customersRes, paymentsRes, productsRes, scaleRes] = await Promise.all([
        getOrders(),
        getCustomers(),
        getPayments(),
        getProducts(),
        getScaleConfig().catch(() => ({ data: null })),
      ]);
      setScaleConfig(resolveScaleConfig(scaleRes.data));
      setOrders(ordersRes.data);
      setCustomers(customersRes.data);
      setPayments(paymentsRes.data);
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

  useEffect(() => {
    setValue('installmentPlanId', '');
  }, [selectedPaymentId, setValue]);

  const requestedByProduct = (watchedItems || []).reduce((acc, item) => {
    if (!item.productId || item.productId === NEW_PRODUCT) return acc;
    const quantity = toKg(item.quantity, item.qtyUnit);
    const rowProduct = products.find((p) => p.id === item.productId);
    if (rowProduct?.isCombo) {
      (rowProduct.components || []).forEach((c) => {
        acc[c.productId] = round3((acc[c.productId] || 0) + quantity * c.quantity);
      });
    } else {
      acc[item.productId] = round3((acc[item.productId] || 0) + quantity);
    }
    return acc;
  }, {});

  const getShortfall = (productId) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return 0;
    return round3(Math.max((requestedByProduct[productId] || 0) - Number(product.stock), 0));
  };

  const { grossSubtotal, grossVat, grossInternal, grossTotal } = (watchedItems || []).reduce((acc, item) => {
    const isNew = item.productId === NEW_PRODUCT;
    const product = isNew ? null : products.find((p) => p.id === item.productId);
    const itemTotal = Math.round(toKg(item.quantity, item.qtyUnit) * cents(item.unitPrice) * 100) / 100;

    const parts = product?.isCombo && (product.components || []).length
      ? splitLineParts(itemTotal, product.components)
      : [splitPrice(
        itemTotal,
        isNew ? item.newProduct?.vatRate : product?.vatRate,
        isNew ? item.newProduct?.otherTaxes : product?.otherTaxes
      )];

    return parts.reduce((sum, part) => ({
      grossSubtotal: sum.grossSubtotal + part.net,
      grossVat: sum.grossVat + part.vat,
      grossInternal: sum.grossInternal + part.internal,
      grossTotal: sum.grossTotal,
    }), { ...acc, grossTotal: acc.grossTotal + itemTotal });
  }, { grossSubtotal: 0, grossVat: 0, grossInternal: 0, grossTotal: 0 });

  const discountPercent = Number(watchedDiscountPercent) || 0;
  const discountAmount = Number(watchedDiscountAmount) || 0;
  const percentDiscountValue = grossTotal * (discountPercent / 100);
  const totalDiscount = percentDiscountValue + discountAmount;
  const hasDiscount = totalDiscount > 0;
  const discountExceedsTotal = totalDiscount > grossTotal;
  const total = Math.max(grossTotal - totalDiscount, 0);
  const scale = grossTotal > 0 ? total / grossTotal : 1;
  const subtotal = grossSubtotal * scale;
  const vatAmount = grossVat * scale;
  const internalTaxAmount = grossInternal * scale;

  const selectedCustomer = customers.find((c) => c.id === selectedCustomerId);
  const fiscalConditionForCalc = isNewCustomer ? newCustomerFiscalCondition : selectedCustomer?.fiscalCondition;
  const discriminatesVat = FISCAL_CONDITIONS_WITH_VAT_BREAKDOWN.includes(fiscalConditionForCalc);

  const selectedPayment = payments.find((p) => p.id === selectedPaymentId);
  const availablePlans = selectedPayment?.installmentPlans || [];
  const selectedPlan = availablePlans.find((p) => p.id === selectedInstallmentPlanId);
  const totalFinanced = selectedPlan ? total * (1 + Number(selectedPlan.interestRate) / 100) : total;
  const installmentAmount = selectedPlan ? totalFinanced / selectedPlan.installments : null;

  // Lo que el operador necesita que le autoricen en este remito (null si no hace falta)
  const approvalRequest = (formData) => {
    const discountPct = Number(formData.discountPercent) || 0;
    const discountAmt = Number(formData.discountAmount) || 0;
    const prices = [];
    for (const item of formData.items) {
      const product = products.find((p) => p.id === item.productId);
      const price = cents(item.unitPrice);
      if (!product || isListPrice(product, price)) continue;
      if (prices.some((p) => p.productId === product.id && samePrice(p.unitPrice, price))) continue;
      prices.push({
        productId: product.id,
        name: product.name,
        unitPrice: price,
        listPrice: Number(product.price),
        perKg: product.unitType === 'weight',
      });
    }
    if (!prices.length && discountPct <= 0 && discountAmt <= 0) return null;
    return { discountPercent: discountPct, discountAmount: discountAmt, prices };
  };

  const openApproval = (formData, notice) => {
    const summary = approvalRequest(formData);
    if (!summary) return false;
    setApproval({ formData, summary, notice });
    return true;
  };

  const handleApprove = async (email, password) => {
    const { formData, summary } = approval;
    const { data } = await approveOrder({
      email,
      password,
      requestId: requestIdRef.current,
      discountPercent: summary.discountPercent,
      discountAmount: summary.discountAmount,
      items: summary.prices.map((p) => ({ productId: p.productId, unitPrice: p.unitPrice })),
    });
    approvalTokenRef.current = data.approvalToken;
    setApproval(null);
    await onSubmit(formData);
  };

  const onProductChange = (index, productId) => {
    const product = products.find((p) => p.id === productId);
    if (product) {
      setValue(`items.${index}.unitPrice`, Number(product.price));
    }
    setValue(`items.${index}.addStock`, false);
    setValue(`items.${index}.qtyUnit`, 'kg');
  };

  // Etiqueta de balanza: trae el PLU del producto y el peso o el importe
  const handleScaleLabel = (label) => {
    const product = products.find((p) => !p.isCombo && p.scalePlu === label.plu);
    if (!product) {
      msg.error(`No hay ningún producto con el PLU ${label.plu}. Cargalo en Productos → campo "PLU de balanza".`, 'scan');
      return;
    }
    if (product.active === false) {
      msg.error(`${product.name} está inactivo: no se puede vender. Activalo en Productos.`, 'scan');
      return;
    }

    const line = lineFromLabel(label, product);
    if (line.noPrice || !(line.quantity > 0)) {
      msg.error(`${product.name} no tiene precio cargado: no se puede calcular la cantidad`, 'scan');
      return;
    }

    const items = watchedItems || [];
    const existing = items.findIndex((it) => it.productId === product.id);
    const emptyIndex = items.findIndex((it) => !it.productId);

    if (existing >= 0) {
      setValue(`items.${existing}.quantity`, round3(toKg(items[existing].quantity, items[existing].qtyUnit) + line.quantity));
      setValue(`items.${existing}.qtyUnit`, 'kg');
    } else if (emptyIndex >= 0) {
      setValue(`items.${emptyIndex}.productId`, product.id);
      onProductChange(emptyIndex, product.id);
      setValue(`items.${emptyIndex}.quantity`, line.quantity);
    } else {
      append({ ...emptyItem(), productId: product.id, unitPrice: Number(product.price), quantity: line.quantity });
    }

    const added = `${product.name}: ${formatQuantity(line.quantity, 'weight')} agregado.`;
    if (line.priceMismatch) {
      msg.error(
        `${added} Ojo: el importe de la etiqueta ($${label.value.toFixed(2)}) no coincide con el precio de ${product.name} en el sistema. Revisá que sean iguales.`,
        'scan'
      );
    } else {
      msg.success(added, 'scan');
    }
  };

  const handleScan = (rawCode) => {
    const code = String(rawCode || '').trim();
    if (!code) return;

    const items = watchedItems || [];
    const emptyIndex = items.findIndex((it) => !it.productId);
    const product = products.find((p) => p.barcode === code || p.internalCode === code);

    if (!product) {
      const label = parseScaleCode(code, scaleConfig);
      if (label) {
        handleScaleLabel(label);
        return;
      }
    }

    if (product && product.active === false) {
      msg.error(`${product.name} está inactivo: no se puede vender. Activalo en Productos.`, 'scan');
      return;
    }

    if (product) {
      const existing = items.findIndex((it) => it.productId === product.id);
      if (existing >= 0) {
        setValue(`items.${existing}.quantity`, (Number(items[existing].quantity) || 0) + 1);
      } else if (emptyIndex >= 0) {
        setValue(`items.${emptyIndex}.productId`, product.id);
        onProductChange(emptyIndex, product.id);
      } else {
        append({ ...emptyItem(), productId: product.id, unitPrice: Number(product.price) });
      }
      msg.success(`${product.name} agregado`, 'scan');
      return;
    }

    if (!canManageData) {
      msg.error(`No hay ningún producto con el código ${code}`, 'scan');
      return;
    }
    if (!window.confirm(`El código ${code} no está registrado. ¿Crear un producto nuevo con ese código?`)) {
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
  // envío: si el servidor ya lo recibió, devuelve el mismo remito en lugar de crear otro.
  const sendingRef = useRef(false);
  const requestIdRef = useRef(newRequestId());
  const onSubmit = async (formData) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    try {
      await submitOrder(formData);
    } finally {
      sendingRef.current = false;
    }
  };

  const submitOrder = async (formData) => {
    msg.clear();
    if (discountExceedsTotal) {
      msg.error('El descuento no puede ser mayor al total del remito');
      return;
    }

    try {
      // Datos del cliente y de los productos nuevos: cada error va debajo de su campo
      let missing = false;
      if (isNewCustomer) {
        const { businessName, firstName, fiscalCondition } = formData.newCustomer;
        if (!businessName && !firstName) {
          setError('newCustomer.firstName', { type: 'manual', message: 'Completá el nombre o la razón social' });
          missing = true;
        }
        if (!fiscalCondition) {
          setError('newCustomer.fiscalCondition', { type: 'manual', message: 'Elegí la condición fiscal' });
          missing = true;
        }
      }

      formData.items.forEach((item, i) => {
        if (item.productId !== NEW_PRODUCT) return;
        const np = item.newProduct || {};
        if (!np.internalCode) {
          setError(`items.${i}.newProduct.internalCode`, { type: 'manual', message: 'Cargá el código interno' });
          missing = true;
        }
        if (!np.name) {
          setError(`items.${i}.newProduct.name`, { type: 'manual', message: 'Cargá el nombre del producto' });
          missing = true;
        }
        if (np.cost === '' || np.cost === undefined) {
          setError(`items.${i}.newProduct.cost`, { type: 'manual', message: 'Cargá el costo' });
          missing = true;
        }
        if (!(Number(item.unitPrice) > 0)) {
          setError(`items.${i}.unitPrice`, { type: 'manual', message: 'Cargá el precio del producto nuevo' });
          missing = true;
        }
      });
      if (missing) return;

      // Operador con descuento o precio fuera de lista: primero la autorización (antes de crear nada)
      if (needsApprovalForChanges && !approvalTokenRef.current && openApproval(formData)) return;

      let customerId = formData.customerId;
      if (isNewCustomer) {
        const { businessName, firstName, lastName, fiscalCondition } = formData.newCustomer;
        const { data: newCustomer } = await createCustomer({
          businessName: businessName || null,
          firstName: businessName ? null : firstName,
          lastName: businessName ? null : lastName,
          fiscalCondition,
        });
        customerId = newCustomer.id;
        setCustomers((prev) => [...prev, newCustomer]);
        setValue('customerId', newCustomer.id);
      }

      const payloadItems = [];
      for (let i = 0; i < formData.items.length; i += 1) {
        const item = formData.items[i];
        let productId = item.productId;
        let addStock = Boolean(item.addStock);

        if (productId === NEW_PRODUCT) {
          const np = item.newProduct;
          const { data: createdProduct } = await createProduct({
            internalCode: np.internalCode,
            barcode: np.barcode || null,
            name: np.name,
            price: Number(item.unitPrice),
            cost: Number(np.cost),
            vatRate: np.vatRate === '' || np.vatRate === undefined ? 21 : Number(np.vatRate),
            otherTaxes: toPercentOrNull(np.otherTaxes),
            unitType: np.unitType || 'unit',
          });
          productId = createdProduct.id;
          addStock = true;
          setProducts((prev) => [...prev, createdProduct]);
          setValue(`items.${i}.productId`, createdProduct.id);
          setValue(`items.${i}.addStock`, true);
        }

        payloadItems.push({
          productId,
          quantity: toKg(item.quantity, item.qtyUnit),
          unitPrice: cents(item.unitPrice),
          addStock,
        });
      }

      const payload = {
        customerId,
        paymentId: formData.paymentId,
        installmentPlanId: formData.installmentPlanId || null,
        discountPercent: Number(formData.discountPercent) || 0,
        discountAmount: Number(formData.discountAmount) || 0,
        notes: formData.notes || null,
        items: payloadItems,
        requestId: requestIdRef.current,
        ...(approvalTokenRef.current ? { approvalToken: approvalTokenRef.current } : {}),
      };

      await createOrder(payload);
      requestIdRef.current = newRequestId();
      approvalTokenRef.current = null;
      msg.success('Remito generado, stock actualizado');
      reset({
        customerId: '',
        paymentId: '',
        installmentPlanId: '',
        discountPercent: 0,
        discountAmount: 0,
        notes: '',
        newCustomer: { firstName: '', lastName: '', businessName: '', fiscalCondition: '' },
        items: [emptyItem()],
      });
      loadAll();
    } catch (err) {
      // "Artículo 2: ..." se muestra en ese renglón; el resto, junto al botón
      // La autorización falta, venció o el remito cambió: se pide de nuevo
      if (err.response?.data?.code === 'APPROVAL_REQUIRED') {
        approvalTokenRef.current = null;
        if (openApproval(formData, err.response.data.message)) return;
      }
      const text = serverMessage(err, 'Error al generar el remito');
      const row = /^Artículo (\d+):\s*/.exec(text);
      if (row) msg.error(text.slice(row[0].length), `row-${Number(row[1]) - 1}`);
      else msg.error(text);
    }
  };

  const customerLabel = (c) => c.businessName || `${c.firstName} ${c.lastName || ''}`.trim();
  const customerOptions = customers.map((c) => ({
    value: c.id,
    label: customerLabel(c),
    detail: [c.fiscalCondition, c.cuit && `CUIT ${c.cuit}`].filter(Boolean).join(' · '),
    keywords: [c.firstName, c.lastName, c.businessName, c.cuit],
  }));
  // Los productos inactivos no se pueden vender (el servidor también lo controla)
  const productOptions = products.filter((p) => p.active !== false).map((p) => ({
    value: p.id,
    label: p.name,
    detail: [p.isCombo && 'Combo', p.internalCode && `Cód. ${p.internalCode}`, p.scalePlu && `PLU ${p.scalePlu}`, `Stock: ${formatQuantity(p.stock, p.unitType)}`]
      .filter(Boolean).join(' · '),
    keywords: [p.internalCode, p.barcode, p.brand, p.model],
  }));
  const displayCustomer = (order) => (order.Customer ? customerLabel(order.Customer) : '—');

  const handleCancel = async (order) => {
    const reason = window.prompt(
      `Vas a anular el remito de ${displayCustomer(order)} por $${Number(order.total).toFixed(2)}.\n`
      + 'El stock de los productos vendidos se devuelve y el remito deja de contar en los reportes.\n\n'
      + 'Motivo (opcional). Aceptá para anular o cancelá para volver:',
      ''
    );
    if (reason === null) return;

    setCancellingId(order.id);
    try {
      await cancelOrder(order.id, reason);
      await loadAll();
      msg.success('Remito anulado, stock devuelto', order.id);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo anular el remito'), order.id);
    } finally {
      setCancellingId(null);
    }
  };

  if (loading) return <Spinner label="Cargando remitos..." />;

  return (
    <div className="orders-page">
      <h1>Remitos / Pedidos</h1>
      <FormMessage message={msg.at('page')} onClose={msg.clear} />

      <form onSubmit={handleSubmit(onSubmit)} className="order-form">
        <div className="field">
          <label htmlFor="customerId">Cliente<RequiredMark /></label>
          <Controller
            name="customerId"
            control={control}
            rules={{ required: 'Elegí un cliente' }}
            render={({ field }) => (
              <SearchSelect
                id="customerId"
                title="Buscar cliente"
                searchPlaceholder="Nombre, razón social o CUIT..."
                placeholder="Elegí un cliente..."
                emptyText="No hay clientes que coincidan"
                value={field.value}
                onChange={field.onChange}
                options={customerOptions}
                extraOptions={canManageData ? [{ value: NEW_CUSTOMER, label: '+ Nuevo cliente...' }] : []}
                hasError={Boolean(errors.customerId)}
              />
            )}
          />
          {errors.customerId && <span className="error">{errors.customerId.message}</span>}
        </div>

        {isNewCustomer && (
          <div className="inline-customer-form">
            <div className="field">
              <label htmlFor="newCustomerBusinessName">Razón social (si es empresa)</label>
              <input id="newCustomerBusinessName" placeholder="Ej: Distribuidora del Sur SA" {...register('newCustomer.businessName')} />
            </div>
            <div className="field">
              <label htmlFor="newCustomerFirstName">Nombre</label>
              <input id="newCustomerFirstName" placeholder="Ej: Juan" {...register('newCustomer.firstName')} />
              {errors.newCustomer?.firstName && <span className="error">{errors.newCustomer?.firstName.message}</span>}
            </div>
            <div className="field">
              <label htmlFor="newCustomerLastName">Apellido</label>
              <input id="newCustomerLastName" placeholder="Ej: Pérez" {...register('newCustomer.lastName')} />
            </div>
            <div className="field">
              <label htmlFor="newCustomerFiscalCondition">Condición fiscal<RequiredMark /></label>
              <select id="newCustomerFiscalCondition" {...register('newCustomer.fiscalCondition')}>
                <option value="">Condición fiscal...</option>
                {FISCAL_CONDITIONS.map((fc) => (
                  <option key={fc} value={fc}>{fc}</option>
                ))}
              </select>
              {errors.newCustomer?.fiscalCondition && <span className="error">{errors.newCustomer?.fiscalCondition.message}</span>}
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="paymentId">Forma de pago<RequiredMark /></label>
          <select id="paymentId" {...register('paymentId', { required: 'Elegí la forma de pago' })}>
            <option value="">Forma de pago...</option>
            {payments.filter((p) => p.active).map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          {errors.paymentId && <span className="error">{errors.paymentId.message}</span>}
        </div>

        {availablePlans.length > 0 && (
          <div className="field">
            <label htmlFor="installmentPlanId">Plan de cuotas</label>
            <select id="installmentPlanId" {...register('installmentPlanId')}>
              <option value="">Pago único (sin financiación)</option>
              {availablePlans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.installments} cuotas {Number(plan.interestRate) > 0 ? `(+${plan.interestRate}% interés)` : '(sin interés)'}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="inline-customer-form">
          <div className="field">
            <label htmlFor="discountPercent">Descuento en %</label>
            <input
              id="discountPercent"
              type="number"
              step="0.01"
              min="0"
              max="100"
              placeholder="Ej: 10"
              {...register('discountPercent')}
            />
          </div>
          <div className="field">
            <label htmlFor="discountAmount">Descuento por monto ($)</label>
            <input
              id="discountAmount"
              type="number"
              step="0.01"
              min="0"
              placeholder="Ej: 500"
              {...register('discountAmount')}
            />
          </div>
        </div>

        {needsApprovalForChanges && (
          <p className="report-note">
            Los descuentos y los precios distintos a los de lista tiene que autorizarlos un administrador o editor:
            al generar el remito se te va a pedir su email y contraseña.
          </p>
        )}

        <div className="field">
          <label htmlFor="notes">Notas (opcional)</label>
          <input id="notes" placeholder="Ej: Entregar antes del viernes" {...register('notes')} />
        </div>

        <ScanBar onScan={handleScan} />
        <FormMessage message={msg.at('scan')} onClose={msg.clear} />

        <div className="purchase-items">
          {fields.map((field, index) => {
            const rowProductId = watchedItems?.[index]?.productId;
            const isNewProduct = rowProductId === NEW_PRODUCT;
            const rowProduct = products.find((p) => p.id === rowProductId);
            const isCombo = Boolean(rowProduct?.isCombo);
            const rowUnitType = isNewProduct ? watchedItems?.[index]?.newProduct?.unitType : rowProduct?.unitType;
            const rowQtyUnit = rowUnitType === 'weight' ? (watchedItems?.[index]?.qtyUnit || 'kg') : 'kg';
            const rowQuantity = toKg(watchedItems?.[index]?.quantity, rowQtyUnit);
            const rowPrice = Number(watchedItems?.[index]?.unitPrice) || 0;
            const shortfall = rowProductId && !isNewProduct && !isCombo ? getShortfall(rowProductId) : 0;
            const comboShortfall = isCombo ? Math.max(rowQuantity - Number(rowProduct.stock), 0) : 0;

            return (
              <div key={field.id} className="purchase-item-row">
                <div className="field">
                  <label htmlFor={`order-item-product-${index}`}>Producto<RequiredMark /></label>
                  <Controller
                    name={`items.${index}.productId`}
                    control={control}
                    rules={{ required: 'Elegí un producto' }}
                    render={({ field: productField }) => (
                      <SearchSelect
                        id={`order-item-product-${index}`}
                        title="Buscar producto"
                        searchPlaceholder="Nombre, código, marca o modelo..."
                        placeholder="Producto..."
                        emptyText="No hay productos que coincidan"
                        value={productField.value}
                        onChange={(value) => {
                          productField.onChange(value);
                          onProductChange(index, value);
                        }}
                        options={productOptions}
                        extraOptions={canManageData ? [{ value: NEW_PRODUCT, label: '+ Nuevo producto...' }] : []}
                        hasError={Boolean(errors.items?.[index]?.productId)}
                      />
                    )}
                  />
                  {errors.items?.[index]?.productId && <span className="error">{errors.items?.[index]?.productId.message}</span>}
                </div>
                <div className="field">
                  <label htmlFor={`order-item-quantity-${index}`}>Cantidad<RequiredMark /></label>
                  <div className={rowUnitType === 'weight' ? 'input-with-action' : undefined}>
                    <input
                      id={`order-item-quantity-${index}`}
                      type="number"
                      step={rowQtyUnit === 'g' ? '1' : quantityStep(rowUnitType)}
                      placeholder={rowUnitType === 'weight' ? (rowQtyUnit === 'g' ? 'Ej: 250' : 'Ej: 1,250') : 'Ej: 2'}
                      {...register(`items.${index}.quantity`, {
                        required: 'Cargá la cantidad',
                        min: { value: rowQtyUnit === 'g' ? 1 : quantityMin(rowUnitType), message: 'La cantidad tiene que ser mayor a 0' },
                      })}
                    />
                    {rowUnitType === 'weight' && (
                      <select aria-label="Unidad de la cantidad" {...register(`items.${index}.qtyUnit`)}>
                        <option value="kg">kg</option>
                        <option value="g">g</option>
                      </select>
                    )}
                  </div>
                  {errors.items?.[index]?.quantity && <span className="error">{errors.items?.[index]?.quantity.message}</span>}
                </div>
                <div className="field">
                  <label htmlFor={`order-item-price-${index}`}>
                    {rowUnitType === 'weight' ? 'Precio por kg' : 'Precio unitario'}<RequiredMark />
                  </label>
                  <input
                    id={`order-item-price-${index}`}
                    type="number"
                    step="0.01"
                    placeholder="Ej: 1500"
                    {...register(`items.${index}.unitPrice`, {
                      required: 'Cargá el precio',
                      min: { value: 0, message: 'El precio no puede ser negativo' },
                    })}
                  />
                  {errors.items?.[index]?.unitPrice && <span className="error">{errors.items?.[index]?.unitPrice.message}</span>}
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

                {rowUnitType === 'weight' && rowQuantity > 0 && (
                  <div className="field field-full">
                    <small className="report-note">
                      {formatQuantity(rowQuantity, 'weight')} × ${rowPrice.toFixed(2)} por kg = ${(Math.round(rowQuantity * rowPrice * 100) / 100).toFixed(2)}
                    </small>
                  </div>
                )}

                {isNewProduct && (
                  <div className="inline-customer-form field-full">
                    <div className="field">
                      <label htmlFor={`new-product-code-${index}`}>Código interno<RequiredMark /></label>
                      <input
                        id={`new-product-code-${index}`}
                        placeholder="Ej: P001"
                        {...register(`items.${index}.newProduct.internalCode`)}
                      />
                      {errors.items?.[index]?.newProduct?.internalCode && <span className="error">{errors.items?.[index]?.newProduct?.internalCode.message}</span>}
                    </div>
                    <div className="field">
                      <label htmlFor={`new-product-barcode-${index}`}>Código de barras</label>
                      <input
                        id={`new-product-barcode-${index}`}
                        {...register(`items.${index}.newProduct.barcode`)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`new-product-name-${index}`}>Producto<RequiredMark /></label>
                      <input
                        id={`new-product-name-${index}`}
                        placeholder="Ej: Cerveza IPA 500ml"
                        {...register(`items.${index}.newProduct.name`)}
                      />
                      {errors.items?.[index]?.newProduct?.name && <span className="error">{errors.items?.[index]?.newProduct?.name.message}</span>}
                    </div>
                    <div className="field">
                      <label htmlFor={`new-product-cost-${index}`}>{rowUnitType === 'weight' ? 'Costo por kg' : 'Costo'}<RequiredMark /></label>
                      <input
                        id={`new-product-cost-${index}`}
                        type="number"
                        step="0.01"
                        placeholder="Ej: 900"
                        {...register(`items.${index}.newProduct.cost`)}
                      />
                      {errors.items?.[index]?.newProduct?.cost && <span className="error">{errors.items?.[index]?.newProduct?.cost.message}</span>}
                    </div>
                    <div className="field">
                      <label htmlFor={`new-product-vat-${index}`}>IVA</label>
                      <VatSelect
                        id={`new-product-vat-${index}`}
                        registration={register(`items.${index}.newProduct.vatRate`)}
                      />
                    </div>
                    <div className="field">
                      <label htmlFor={`new-product-internal-${index}`}>Impuestos internos (%) <small>(opcional)</small></label>
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
                    <div className="field">
                      <label htmlFor={`new-product-unit-${index}`}>Unidad de comercialización</label>
                      <select id={`new-product-unit-${index}`} {...register(`items.${index}.newProduct.unitType`)}>
                        <option value="unit">Por unidad</option>
                        <option value="weight">Por peso</option>
                      </select>
                    </div>
                    <div className="field field-full stock-warning">
                      <span>
                        El precio del producto será el "Precio unitario" de esta fila. Se crea con stock 0 y,
                        al generar el remito, se cargan al stock {formatQuantity(rowQuantity, rowUnitType)} de esta fila.
                      </span>
                    </div>
                  </div>
                )}

                {isCombo && (
                  <div className="field field-full">
                    <small>
                      Incluye: {(rowProduct.components || []).map((c) => `${c.quantity}× ${c.name}`).join(', ')}
                    </small>
                  </div>
                )}

                {comboShortfall > 0 && (
                  <div className="field field-full stock-warning">
                    <span>
                      Stock insuficiente para el combo {rowProduct.name}: se pueden armar {formatQuantity(rowProduct.stock)},
                      pedís {rowQuantity}. Revisá el stock de los productos que lo forman.
                    </span>
                  </div>
                )}

                {shortfall > 0 && (
                  <div className="field field-full stock-warning">
                    <span>
                      Stock insuficiente en {rowProduct?.name}: disponible {formatQuantity(rowProduct?.stock, rowProduct?.unitType)}, faltan {formatQuantity(shortfall, rowProduct?.unitType)}.
                    </span>
                    {canManageData ? (
                      <label className="stock-warning-label">
                        <input type="checkbox" {...register(`items.${index}.addStock`)} />
                        Cargar al stock {formatQuantity(shortfall, rowProduct?.unitType)} que faltan al generar el remito.
                      </label>
                    ) : (
                      <span>Pedile a un editor o administrador que cargue stock.</span>
                    )}
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

        <button type="button" onClick={() => append(emptyItem())}>
          + Agregar producto
        </button>

        <div className="purchase-total">
          {(discriminatesVat || hasDiscount) && (
            <div>Importe: ${grossTotal.toFixed(2)}</div>
          )}
          {hasDiscount && (
            <div>Descuento: -${totalDiscount.toFixed(2)}</div>
          )}
          {discriminatesVat ? (
            <>
              <div>Subtotal: ${subtotal.toFixed(2)}</div>
              <div>IVA: ${vatAmount.toFixed(2)}</div>
              {internalTaxAmount > 0 && <div>Impuestos internos: ${internalTaxAmount.toFixed(2)}</div>}
              <div>Total: ${total.toFixed(2)}</div>
            </>
          ) : (
            <div>Total: ${total.toFixed(2)}</div>
          )}
          {discountExceedsTotal && (
            <div className="error">El descuento no puede ser mayor al total</div>
          )}

          {selectedPlan && (
            <>
              <div>Cantidad de cuotas: {selectedPlan.installments}</div>
              <div>Monto de cada cuota: ${installmentAmount.toFixed(2)}</div>
              <div>Precio total financiado: ${totalFinanced.toFixed(2)}</div>
            </>
          )}
        </div>

        <button type="submit" disabled={discountExceedsTotal || isSubmitting}>
          {isSubmitting ? 'Generando remito…' : 'Generar remito'}
        </button>
        <FormMessage message={msg.at()} onClose={msg.clear} />
        <RequiredLegend />
      </form>

      {approval && (
        <ApprovalDialog
          summary={approval.summary}
          notice={approval.notice}
          onApprove={handleApprove}
          onCancel={() => setApproval(null)}
        />
      )}

      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>N°</th>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Forma de pago</th>
              <th>Total</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((order) => {
              const cancelled = order.status === 'cancelled';
              return (
                <tr key={order.id} className={cancelled ? 'order-cancelled' : ''}>
                  <td data-label="N°">{orderNumberLabel(order)}</td>
                  <td data-label="Fecha">
                    {new Date(order.date).toLocaleDateString('es-AR')}
                    {order.createdByName && <small className="row-author">por {order.createdByName}</small>}
                  </td>
                  <td data-label="Cliente">
                    {displayCustomer(order)}
                    {cancelled && <span className="badge-cancelled">Anulado</span>}
                  </td>
                  <td data-label="Forma de pago">{order.Payment?.name || '—'}</td>
                  <td data-label="Total">
                    <span className="amount">${Number(order.totalFinanced || order.total).toFixed(2)}</span>
                  </td>
                  <td data-label="Acciones">
                    <Link to={`/orders/${order.id}/print`}>
                      <button type="button">Ver / Imprimir</button>
                    </Link>
                    {canManageData && !cancelled && (
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={cancellingId === order.id}
                        onClick={() => handleCancel(order)}
                      >
                        {cancellingId === order.id ? 'Anulando…' : 'Anular'}
                      </button>
                    )}
                    <FormMessage message={msg.at(order.id)} onClose={msg.clear} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default Orders;
