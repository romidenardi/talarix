import { Customer, Order, CustomerPayment } from '../models/index.js';
import { audit } from '../utils/audit.js';
import { round2 } from '../utils/numbers.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { pick } from '../utils/pick.js';
import { normalizeTaxId, taxIdDigits } from '../utils/taxId.js';
import { normalizeFiscalCondition, FISCAL_CONDITIONS } from '../utils/importValues.js';

// Campos que se pueden cargar o editar desde la API (nunca businessId ni id)
const CUSTOMER_FIELDS = [
  'businessName',
  'firstName',
  'lastName',
  'fiscalCondition',
  'cuit',
  'address',
  'zipCode',
  'city',
  'province',
  'phone',
  'email',
  'openingBalance',
];

// Saldo inicial de la cuenta corriente (lo que debía al empezar a usar el sistema): vacío = 0
const cleanOpeningBalance = (data) => {
  if (!('openingBalance' in data)) return data;
  if (data.openingBalance === '' || data.openingBalance === null) data.openingBalance = 0;
  const value = Number(data.openingBalance);
  if (!Number.isFinite(value) || Math.abs(value) > 999999999) {
    throw httpError('El saldo inicial tiene que ser un número.');
  }
  data.openingBalance = round2(value);
  return data;
};

// Condición fiscal: solo los cuatro valores del sistema (acepta variantes: "RI", "responsable
// inscripto", "CF"…). Si no coincide, el remito no sabría si discriminar IVA.
const cleanFiscalCondition = (data) => {
  if (!('fiscalCondition' in data)) return data;
  const value = normalizeFiscalCondition(data.fiscalCondition);
  if (!value)
    throw httpError(
      `La condición fiscal tiene que ser ${FISCAL_CONDITIONS.join(', ').replace(/, ([^,]*)$/, ' o $1')}.`,
    );
  data.fiscalCondition = value;
  return data;
};

// CUIT (o DNI): se valida y se guarda con formato. Si al editar viene el mismo que ya tenía, no se
// revisa (para no trabar la edición de clientes cargados antes de esta validación).
const cleanTaxId = (data, current = null) => {
  if (!('cuit' in data)) return data;
  if (current && taxIdDigits(current) && taxIdDigits(current) === taxIdDigits(data.cuit)) {
    delete data.cuit;
    return data;
  }
  const { value, error } = normalizeTaxId(data.cuit);
  if (error) throw httpError(error);
  data.cuit = value;
  return data;
};

const displayName = (c) => c.businessName || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'El cliente';

const findOwnCustomer = async (id, businessId) => {
  const customer = await Customer.findOne({ where: { id, businessId } });
  if (!customer) throw httpError('Cliente no encontrado.', 404);
  return customer;
};

export const getCustomers = asyncHandler(async (req, res) => {
  const customers = await Customer.findAll({ where: { businessId: req.user.businessId } });
  res.json(customers);
});

export const createCustomer = asyncHandler(async (req, res) => {
  const customer = await Customer.create({
    ...cleanTaxId(cleanOpeningBalance(cleanFiscalCondition(pick(req.body, CUSTOMER_FIELDS)))),
    businessId: req.user.businessId,
  });
  res.status(201).json(customer);
});

export const updateCustomer = asyncHandler(async (req, res) => {
  const customer = await findOwnCustomer(req.params.id, req.user.businessId);
  if (customer.anonymizedAt) {
    throw httpError('Este cliente fue anonimizado por un pedido de supresión de datos: no se puede editar.', 409);
  }
  const previousOpening = Number(customer.openingBalance);
  const data = cleanTaxId(cleanOpeningBalance(cleanFiscalCondition(pick(req.body, CUSTOMER_FIELDS))), customer.cuit);
  await customer.update(data);
  // Cambiar el saldo inicial mueve la cuenta corriente: queda registrado
  if ('openingBalance' in data && data.openingBalance !== previousOpening) {
    await audit(req, {
      action: 'customer.opening_balance_changed',
      targetType: 'customer',
      targetId: customer.id,
      detail: { from: previousOpening, to: data.openingBalance },
    });
  }
  res.json(customer);
});

export const deleteCustomer = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const customer = await findOwnCustomer(req.params.id, businessId);

  // Un cliente con remitos o cobranzas no se borra: se perdería el historial
  const payments = await CustomerPayment.count({ where: { customerId: customer.id, businessId } });
  if (payments > 0) {
    throw httpError(
      `${displayName(customer)} tiene cobranzas registradas y no se puede eliminar, porque se perdería su cuenta corriente.`,
      409,
    );
  }
  const orders = await Order.count({ where: { customerId: customer.id, businessId } });
  if (orders > 0) {
    throw httpError(
      `${displayName(customer)} tiene ${orders} ${orders === 1 ? 'remito' : 'remitos'} y no se puede eliminar, ` +
        'porque se perdería el historial de ventas. Si te pidió que borres sus datos, un administrador puede usar "Anonimizar.".',
      409,
    );
  }

  await customer.destroy();
  res.status(204).send();
});
