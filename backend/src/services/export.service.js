import * as XLSX from 'xlsx';
import {
  Business,
  Category,
  Product,
  StockMovement,
  Payment,
  InstallmentPlan,
  User,
  Customer,
  Supplier,
  Purchase,
  PurchaseItem,
  Order,
  OrderItem,
  ComboItem,
} from '../models/index.js';

const TIMEZONE = 'America/Argentina/Buenos_Aires';

const NUMERIC_TYPES = new Set([
  'DECIMAL',
  'INTEGER',
  'BIGINT',
  'FLOAT',
  'DOUBLE',
  'REAL',
  'SMALLINT',
  'TINYINT',
  'MEDIUMINT',
]);

const ALWAYS_EXCLUDED = ['businessId'];
const EXCLUDED_BY_MODEL = {
  User: ['passwordHash', 'inviteTokenHash', 'inviteExpiresAt'],
};

const formatDateTime = (value) => value.toLocaleString('es-AR', { timeZone: TIMEZONE });

export const todayStamp = () => new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE });

const formatValue = (value, typeKey) => {
  if (value === null || value === undefined) return '';
  if (typeKey === 'BOOLEAN') return value ? 'Sí' : 'No';
  if (value instanceof Date) return formatDateTime(value);
  if (NUMERIC_TYPES.has(typeKey) && value !== '' && !Number.isNaN(Number(value))) return Number(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
};

export const columnsOf = (Model) =>
  Object.keys(Model.rawAttributes).filter(
    (name) => !ALWAYS_EXCLUDED.includes(name) && !(EXCLUDED_BY_MODEL[Model.name] || []).includes(name),
  );

export const sheetFrom = (Model, rows, extras = {}) => {
  const columns = columnsOf(Model);
  const extraNames = Object.keys(extras);
  const data = rows.map((row) => {
    const out = {};
    for (const column of columns) {
      out[column] = formatValue(row[column], Model.rawAttributes[column].type?.key);
    }
    for (const name of extraNames) out[name] = extras[name](row);
    return out;
  });
  return { header: [...columns, ...extraNames], data };
};

export const buildWorkbookBuffer = (sheets) => {
  const workbook = XLSX.utils.book_new();

  for (const sheet of sheets) {
    let worksheet;
    if (sheet.aoa) {
      worksheet = XLSX.utils.aoa_to_sheet(sheet.aoa);
      worksheet['!cols'] = [{ wch: 28 }, { wch: 90 }];
    } else {
      worksheet = XLSX.utils.json_to_sheet(sheet.data, { header: sheet.header });
      worksheet['!cols'] = sheet.header.map((name) => ({
        wch: Math.min(40, Math.max(String(name).length + 2, 14)),
      }));
    }
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name);
  }

  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
};

const orderByCreated = (Model) => (Model.rawAttributes.createdAt ? [['createdAt', 'ASC']] : undefined);

const byBusiness = (Model, businessId) =>
  Model.findAll({ where: { businessId }, order: orderByCreated(Model), raw: true });

const byParent = (Model, Parent, businessId, as) => {
  const include = { model: Parent, attributes: [], required: true, where: { businessId } };
  if (as) include.as = as;
  return Model.findAll({ include: [include], order: orderByCreated(Model), raw: true });
};

const labelOf = (row) => row.name || row.businessName || [row.lastName, row.firstName].filter(Boolean).join(' ') || '';

const namesById = (rows) => new Map(rows.map((row) => [row.id, labelOf(row)]));

export const buildBusinessExport = async (businessId) => {
  const business = await Business.findByPk(businessId, { attributes: ['id', 'name'] });

  const [
    categories,
    products,
    comboItems,
    customers,
    suppliers,
    purchases,
    purchaseItems,
    orders,
    orderItems,
    payments,
    installmentPlans,
    stockMovements,
    users,
  ] = await Promise.all([
    byBusiness(Category, businessId),
    byBusiness(Product, businessId),
    byParent(ComboItem, Product, businessId, 'combo'),
    byBusiness(Customer, businessId),
    byBusiness(Supplier, businessId),
    byBusiness(Purchase, businessId),
    byParent(PurchaseItem, Purchase, businessId),
    byBusiness(Order, businessId),
    byParent(OrderItem, Order, businessId),
    byBusiness(Payment, businessId),
    byParent(InstallmentPlan, Payment, businessId),
    byParent(StockMovement, Product, businessId),
    byBusiness(User, businessId),
  ]);

  const productNames = namesById(products);
  const customerNames = namesById(customers);
  const supplierNames = namesById(suppliers);

  const productOf = (row) => productNames.get(row.productId) || '';

  const sheets = [
    {
      name: 'Léame',
      aoa: [
        ['Exportación de datos', business?.name || ''],
        ['Fecha', formatDateTime(new Date())],
        ['Contenido', 'Cada hoja corresponde a un tema: productos, clientes, remitos, compras, etc.'],
        [
          'Identificadores',
          'Las columnas que terminan en "Id" relacionan unas hojas con otras. Las columnas de nombre al final de cada hoja se agregaron para facilitar la lectura.',
        ],
        ['Usuarios', 'No incluyen contraseñas ni enlaces de acceso.'],
      ],
    },
    { name: 'Productos', ...sheetFrom(Product, products) },
    {
      name: 'Componentes de combos',
      ...sheetFrom(ComboItem, comboItems, {
        comboNombre: (row) => productNames.get(row.comboId) || '',
        productoNombre: productOf,
      }),
    },
    { name: 'Categorías', ...sheetFrom(Category, categories) },
    { name: 'Clientes', ...sheetFrom(Customer, customers) },
    { name: 'Proveedores', ...sheetFrom(Supplier, suppliers) },
    {
      name: 'Compras',
      ...sheetFrom(Purchase, purchases, {
        proveedorNombre: (row) => supplierNames.get(row.supplierId) || '',
      }),
    },
    { name: 'Detalle de compras', ...sheetFrom(PurchaseItem, purchaseItems, { productoNombre: productOf }) },
    {
      name: 'Remitos',
      ...sheetFrom(Order, orders, {
        clienteNombre: (row) => customerNames.get(row.customerId) || '',
      }),
    },
    { name: 'Detalle de remitos', ...sheetFrom(OrderItem, orderItems, { productoNombre: productOf }) },
    { name: 'Formas de pago', ...sheetFrom(Payment, payments) },
    { name: 'Planes de cuotas', ...sheetFrom(InstallmentPlan, installmentPlans) },
    { name: 'Movimientos de stock', ...sheetFrom(StockMovement, stockMovements, { productoNombre: productOf }) },
    { name: 'Usuarios', ...sheetFrom(User, users) },
  ];

  return {
    buffer: buildWorkbookBuffer(sheets),
    filename: `talarix-datos-${todayStamp()}.xlsx`,
  };
};
