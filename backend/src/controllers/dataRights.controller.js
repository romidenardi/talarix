import { Customer, Order, OrderItem, sequelize } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { buildWorkbookBuffer, sheetFrom, columnsOf, todayStamp } from '../services/export.service.js';
import { audit } from '../utils/audit.js';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const CUSTOMER_LABELS = {
  id: 'Id',
  businessName: 'Razón social',
  firstName: 'Nombre',
  lastName: 'Apellido',
  fiscalCondition: 'Condición fiscal',
  cuit: 'CUIT',
  address: 'Domicilio',
  zipCode: 'Código postal',
  city: 'Localidad',
  province: 'Provincia',
  phone: 'Teléfono',
  email: 'Email',
  createdAt: 'Fecha de alta',
  updatedAt: 'Última modificación',
};

const findCustomer = async (req) => {
  const customer = await Customer.findOne({
    where: { id: req.params.id, businessId: req.user.businessId },
  });
  if (!customer) throw httpError('Cliente no encontrado', 404);
  return customer;
};

export const exportCustomerData = asyncHandler(async (req, res) => {
  const customer = await findCustomer(req);
  const businessId = req.user.businessId;

  const orders = await Order.findAll({
    where: { customerId: customer.id, businessId },
    order: [['createdAt', 'ASC']],
    raw: true,
  });
  const orderIds = orders.map((order) => order.id);
  const items = orderIds.length ? await OrderItem.findAll({ where: { orderId: orderIds }, raw: true }) : [];

  const plain = customer.get({ plain: true });
  const dataRows = columnsOf(Customer).map((column) => ({
    Campo: CUSTOMER_LABELS[column] || column,
    Valor:
      plain[column] instanceof Date
        ? plain[column].toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' })
        : (plain[column] ?? ''),
  }));

  const buffer = buildWorkbookBuffer([
    { name: 'Datos del cliente', header: ['Campo', 'Valor'], data: dataRows },
    { name: 'Remitos', ...sheetFrom(Order, orders) },
    { name: 'Detalle de remitos', ...sheetFrom(OrderItem, items) },
  ]);

  console.log(`[derechos] acceso · comercio ${businessId} · cliente ${customer.id} · usuario ${req.user.id}`);
  await audit(req, { action: 'customer.data_exported', targetType: 'customer', targetId: customer.id });

  res.setHeader('Content-Type', XLSX_MIME);
  res.setHeader('Content-Disposition', `attachment; filename="cliente-datos-${todayStamp()}.xlsx"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  res.send(buffer);
});

export const anonymizeCustomer = asyncHandler(async (req, res) => {
  const customer = await findCustomer(req);
  if (customer.anonymizedAt) throw httpError('Este cliente ya fue anonimizado', 409);

  // Se borran sus datos y también los textos libres de sus remitos (notas y motivo de anulación),
  // que pueden tener su nombre o su teléfono. Los importes y productos se conservan.
  const t = await sequelize.transaction();
  try {
    await customer.update(
      {
        businessName: null,
        firstName: null,
        lastName: 'Cliente anonimizado',
        cuit: null,
        address: null,
        zipCode: null,
        city: null,
        province: null,
        phone: null,
        email: null,
        anonymizedAt: new Date(),
      },
      { transaction: t },
    );
    await Order.update(
      { notes: null, cancelReason: null },
      { where: { customerId: customer.id, businessId: req.user.businessId }, transaction: t },
    );
    await t.commit();
  } catch (error) {
    await t.rollback();
    throw error;
  }

  console.log(
    `[derechos] supresión · comercio ${req.user.businessId} · cliente ${customer.id} · usuario ${req.user.id}`,
  );
  await audit(req, { action: 'customer.anonymized', targetType: 'customer', targetId: customer.id });

  res.json({ message: 'Los datos personales del cliente fueron anonimizados. Sus remitos se conservan.' });
});
