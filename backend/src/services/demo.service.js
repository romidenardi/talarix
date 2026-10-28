import pkg from 'sequelize';
import {
  Business,
  Category,
  Product,
  StockMovement,
  Payment,
  InstallmentPlan,
  Customer,
  Supplier,
  Purchase,
  PurchaseItem,
  Order,
  OrderItem,
  sequelize,
  OrderPayment,
  TabItem,
  KitchenTicket,
  TableTab,
  DiningTable,
} from '../models/index.js';
import { httpError } from '../utils/httpError.js';
import { round2 } from '../utils/numbers.js';
import { moveStock, actorFields } from './stock.service.js';
import { priceOrder, discriminatesVatFor } from './orderPricing.js';
import { nextOrderNumber, formatOrderNumber } from './orderNumber.service.js';

const { Op } = pkg;
const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgoDate = (days) => new Date(Date.now() - days * DAY_MS);

const wipeBusinessData = async (businessId, t) => {
  const idsOf = async (Model) =>
    (await Model.findAll({ where: { businessId }, attributes: ['id'], raw: true, transaction: t })).map(
      (row) => row.id,
    );

  for (const Model of [OrderPayment, TabItem, KitchenTicket, TableTab, DiningTable]) {
    await Model.destroy({ where: { businessId }, transaction: t });
  }

  const orderIds = await idsOf(Order);
  if (orderIds.length) await OrderItem.destroy({ where: { orderId: { [Op.in]: orderIds } }, transaction: t });
  await Order.destroy({ where: { businessId }, transaction: t });

  const purchaseIds = await idsOf(Purchase);
  if (purchaseIds.length)
    await PurchaseItem.destroy({ where: { purchaseId: { [Op.in]: purchaseIds } }, transaction: t });
  await Purchase.destroy({ where: { businessId }, transaction: t });

  await StockMovement.destroy({ where: { businessId }, transaction: t });

  const paymentIds = await idsOf(Payment);
  if (paymentIds.length)
    await InstallmentPlan.destroy({ where: { paymentId: { [Op.in]: paymentIds } }, transaction: t });
  await Payment.destroy({ where: { businessId }, transaction: t });

  await Product.destroy({ where: { businessId }, transaction: t });
  await Category.update({ parentId: null }, { where: { businessId }, transaction: t });
  await Category.destroy({ where: { businessId }, transaction: t });
  await Customer.destroy({ where: { businessId }, transaction: t });
  await Supplier.destroy({ where: { businessId }, transaction: t });
};

// ---------- Datos de ejemplo ----------
const PRODUCTS = [
  // [código, código de barras, nombre, marca, categoría, precio, costo, IVA, stock inicial]
  ['ALM-001', '7790000000011', 'Yerba mate 1 kg', 'Don Mateo', 'Almacén', 6200, 4300, 21, 8],
  ['ALM-002', '7790000000028', 'Fideos tirabuzón 500 g', 'Doña Rosa', 'Almacén', 1450, 980, 10.5, 40],
  ['ALM-003', '7790000000035', 'Aceite de girasol 900 ml', 'Sol Naciente', 'Almacén', 3100, 2200, 21, 24],
  ['ALM-004', '7790000000042', 'Azúcar 1 kg', 'Dulce Norte', 'Almacén', 1350, 900, 21, 50],
  ['ALM-005', '7790000000059', 'Café molido 250 g', 'Aroma Real', 'Almacén', 4800, 3300, 21, 2],
  ['BEB-001', '7790000000066', 'Gaseosa cola 2,25 L', 'Cola Max', 'Gaseosas', 3200, 2300, 21, 36],
  ['BEB-002', '7790000000073', 'Agua mineral 1,5 L', 'Manantial', 'Bebidas', 1300, 850, 21, 60],
  ['BEB-003', '7790000000080', 'Cerveza rubia lata 473 ml', 'Del Litoral', 'Bebidas', 1900, 1300, 21, 48],
  ['LIM-001', '7790000000097', 'Lavandina 1 L', 'Blanquita', 'Limpieza', 1100, 700, 21, 30],
  ['LIM-002', '7790000000103', 'Detergente 750 ml', 'Brillo Plus', 'Limpieza', 2400, 1600, 21, 22],
  ['GOL-001', '7790000000110', 'Alfajor triple', 'Dulce Sur', 'Golosinas', 1200, 780, 21, 80],
  ['GOL-002', '7790000000127', 'Chocolate con leche 100 g', 'Cacao Sur', 'Golosinas', 2300, 1500, 21, 35],
];

// Los datos de ejemplo usan el mismo cálculo, la misma numeración y el mismo movimiento de stock
// que los remitos y compras reales: no pueden quedar distintos.
const DEMO_ACTOR = { id: null, name: 'Datos de ejemplo' };

const seedOrder = async ({
  t,
  businessId,
  customer,
  payment,
  plan = null,
  lines,
  daysAgo,
  products,
  discountPercent = 0,
  discountAmount = 0,
}) => {
  const discriminatesVat = discriminatesVatFor(customer.fiscalCondition);
  const resolved = lines.map(([code, quantity]) => ({
    product: products[code],
    quantity,
    unitPrice: Number(products[code].price),
    vatRate: Number(products[code].vatRate) || 0,
    otherTaxes: products[code].otherTaxes ?? null,
  }));

  const totals = priceOrder({ lines: resolved, discountPercent, discountAmount, discriminatesVat, plan });
  const date = daysAgoDate(daysAgo);
  const order = await Order.create(
    {
      businessId,
      number: await nextOrderNumber(businessId, t),
      customerId: customer.id,
      paymentId: payment.id,
      installmentPlanId: plan ? plan.id : null,
      date,
      grossTotal: totals.grossTotal,
      discountPercent,
      discountAmount,
      total: totals.total,
      subtotal: totals.subtotal,
      vatAmount: totals.vatAmount,
      internalTaxAmount: totals.internalTaxAmount,
      discriminatesVat,
      installmentsCount: totals.installmentsCount,
      interestRate: totals.interestRate,
      installmentAmount: totals.installmentAmount,
      totalFinanced: totals.totalFinanced,
      ...actorFields(DEMO_ACTOR),
    },
    { transaction: t },
  );

  const customerName = customer.businessName || [customer.firstName, customer.lastName].filter(Boolean).join(' ');
  for (const line of resolved) {
    await OrderItem.create(
      {
        orderId: order.id,
        productId: line.product.id,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        vatRate: line.vatRate,
        otherTaxes: line.otherTaxes,
      },
      { transaction: t },
    );
    await moveStock(
      {
        product: line.product,
        type: 'out',
        delta: -line.quantity,
        reason: `Venta, remito ${formatOrderNumber(order)} a ${customerName}`,
        actor: DEMO_ACTOR,
        date,
      },
      t,
    );
  }
};

const seedPurchase = async ({ t, businessId, supplier, invoiceNumber, daysAgo, lines, products }) => {
  const resolved = lines.map(([code, quantity, unitCost]) => ({ product: products[code], quantity, unitCost }));
  const total = round2(resolved.reduce((sum, l) => sum + l.quantity * l.unitCost, 0));
  const date = daysAgoDate(daysAgo);

  const purchase = await Purchase.create(
    { businessId, supplierId: supplier.id, invoiceNumber, date, total, ...actorFields(DEMO_ACTOR) },
    { transaction: t },
  );

  for (const { product, quantity, unitCost } of resolved) {
    await PurchaseItem.create(
      { purchaseId: purchase.id, productId: product.id, quantity, unitCost },
      { transaction: t },
    );
    product.cost = unitCost;
    await moveStock(
      {
        product,
        type: 'in',
        delta: quantity,
        reason: `Compra a ${supplier.name}, factura ${invoiceNumber}`,
        actor: DEMO_ACTOR,
        date,
      },
      t,
    );
  }
};

const seedDemoData = async (businessId, t) => {
  // Categorías
  const categories = {};
  for (const name of ['Almacén', 'Bebidas', 'Limpieza', 'Golosinas']) {
    categories[name] = await Category.create({ businessId, name }, { transaction: t });
  }
  categories.Gaseosas = await Category.create(
    { businessId, name: 'Gaseosas', parentId: categories.Bebidas.id },
    { transaction: t },
  );

  // Productos con su stock inicial
  const products = {};
  for (const [code, barcode, name, brand, category, price, cost, vatRate, stock] of PRODUCTS) {
    products[code] = await Product.create(
      {
        businessId,
        internalCode: code,
        barcode,
        name,
        brand,
        price,
        cost,
        vatRate,
        unitType: 'unit',
        stock: 0,
        categoryId: categories[category].id,
      },
      { transaction: t },
    );
    await moveStock(
      {
        product: products[code],
        type: 'adjustment',
        delta: stock,
        reason: 'Stock inicial',
        actor: DEMO_ACTOR,
        date: daysAgoDate(20),
      },
      t,
    );
  }

  // Clientes
  const customers = {
    mostrador: await Customer.create(
      {
        businessId,
        firstName: 'Cliente',
        lastName: 'Mostrador',
        fiscalCondition: 'Consumidor Final',
      },
      { transaction: t },
    ),
    distribuidora: await Customer.create(
      {
        businessId,
        businessName: 'Distribuidora Ejemplo S.A.',
        fiscalCondition: 'Responsable Inscripto',
        cuit: '30000000001',
        address: 'Av. Ejemplo 123',
        city: 'Rafaela',
        province: 'Santa Fe',
        email: 'compras@example.com',
      },
      { transaction: t },
    ),
    lucia: await Customer.create(
      {
        businessId,
        firstName: 'Lucía',
        lastName: 'Fernández',
        fiscalCondition: 'Monotributista',
        cuit: '27000000002',
        city: 'Rafaela',
        province: 'Santa Fe',
        email: 'lucia@example.com',
      },
      { transaction: t },
    ),
    kiosco: await Customer.create(
      {
        businessId,
        businessName: 'Kiosco La Esquina',
        fiscalCondition: 'Monotributista',
        cuit: '30000000003',
        city: 'Sunchales',
        province: 'Santa Fe',
      },
      { transaction: t },
    ),
  };

  // Proveedores
  const suppliers = {
    mayorista: await Supplier.create(
      {
        businessId,
        name: 'Mayorista Demo S.R.L.',
        cuit: '30000000004',
        city: 'Rafaela',
        province: 'Santa Fe',
        contactPerson: 'Marcos Gómez',
        email: 'ventas@example.com',
      },
      { transaction: t },
    ),
    bebidas: await Supplier.create(
      {
        businessId,
        name: 'Bebidas del Centro S.A.',
        cuit: '30000000005',
        city: 'Santa Fe',
        province: 'Santa Fe',
        contactPerson: 'Ana Ruiz',
      },
      { transaction: t },
    ),
  };

  // Formas de pago y planes de cuotas
  const efectivo = await Payment.create({ businessId, name: 'Efectivo' }, { transaction: t });
  const transferencia = await Payment.create({ businessId, name: 'Transferencia' }, { transaction: t });
  const tarjeta = await Payment.create({ businessId, name: 'Tarjeta de crédito' }, { transaction: t });
  const plans = {};
  for (const [installments, interestRate] of [
    [3, 12],
    [6, 25],
    [12, 45],
  ]) {
    plans[installments] = await InstallmentPlan.create(
      { paymentId: tarjeta.id, installments, interestRate },
      { transaction: t },
    );
  }

  // Historial de compras
  await seedPurchase({
    t,
    businessId,
    products,
    supplier: suppliers.mayorista,
    invoiceNumber: 'A-0001-00001234',
    daysAgo: 12,
    lines: [
      ['ALM-002', 30, 980],
      ['ALM-003', 12, 2200],
      ['ALM-004', 20, 900],
    ],
  });
  await seedPurchase({
    t,
    businessId,
    products,
    supplier: suppliers.bebidas,
    invoiceNumber: 'A-0003-00000567',
    daysAgo: 5,
    lines: [
      ['BEB-001', 24, 2300],
      ['BEB-002', 36, 850],
      ['BEB-003', 24, 1300],
    ],
  });

  // Historial de remitos
  await seedOrder({
    t,
    businessId,
    products,
    customer: customers.mostrador,
    payment: efectivo,
    daysAgo: 9,
    lines: [
      ['ALM-001', 2],
      ['BEB-001', 3],
      ['GOL-001', 6],
    ],
  });
  await seedOrder({
    t,
    businessId,
    products,
    customer: customers.distribuidora,
    payment: transferencia,
    daysAgo: 8,
    lines: [
      ['ALM-002', 10],
      ['ALM-003', 6],
      ['ALM-004', 10],
      ['LIM-002', 4],
    ],
  });
  await seedOrder({
    t,
    businessId,
    products,
    customer: customers.lucia,
    payment: tarjeta,
    plan: plans[3],
    daysAgo: 6,
    lines: [
      ['ALM-005', 2],
      ['GOL-002', 4],
      ['BEB-003', 6],
    ],
  });
  await seedOrder({
    t,
    businessId,
    products,
    customer: customers.mostrador,
    payment: efectivo,
    daysAgo: 4,
    discountPercent: 10,
    lines: [
      ['BEB-002', 12],
      ['GOL-001', 10],
      ['LIM-001', 4],
    ],
  });
  await seedOrder({
    t,
    businessId,
    products,
    customer: customers.kiosco,
    payment: transferencia,
    daysAgo: 3,
    discountAmount: 2000,
    lines: [
      ['BEB-001', 12],
      ['BEB-003', 12],
      ['GOL-002', 10],
    ],
  });
  await seedOrder({
    t,
    businessId,
    products,
    customer: customers.distribuidora,
    payment: tarjeta,
    plan: plans[6],
    daysAgo: 1,
    lines: [
      ['ALM-001', 3],
      ['LIM-002', 6],
      ['LIM-001', 8],
    ],
  });
};

const resetting = new Set();

export const resetDemoBusiness = async (businessId) => {
  const business = await Business.findByPk(businessId);
  if (!business) throw httpError('Comercio no encontrado', 404);
  // Protección: jamás se borran datos de un comercio que no sea demo
  if (business.type !== 'demo') {
    throw httpError('Solo se puede reiniciar un comercio de tipo demo', 400);
  }
  if (resetting.has(businessId)) throw httpError('La demo ya se está reiniciando', 409);

  resetting.add(businessId);
  const t = await sequelize.transaction();
  try {
    await wipeBusinessData(businessId, t);
    await seedDemoData(businessId, t);
    await t.commit();
  } catch (error) {
    await t.rollback();
    throw error;
  } finally {
    resetting.delete(businessId);
  }
};

export const resetAllDemoBusinesses = async () => {
  const demos = await Business.findAll({ where: { type: 'demo' }, attributes: ['id', 'name'] });
  for (const demo of demos) {
    try {
      await resetDemoBusiness(demo.id);
      console.log(`[demo] Reiniciada: ${demo.name}`);
    } catch (error) {
      console.error(`[demo] Error al reiniciar ${demo.name}:`, error.message);
    }
  }
};
