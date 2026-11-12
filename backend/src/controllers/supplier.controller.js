import { Supplier, Purchase, SupplierPayment } from '../models/index.js';
import { audit } from '../utils/audit.js';
import { round2 } from '../utils/numbers.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { pick } from '../utils/pick.js';
import { normalizeTaxId, taxIdDigits } from '../utils/taxId.js';

// Campos que se pueden cargar o editar desde la API (nunca businessId ni id)
const SUPPLIER_FIELDS = [
  'name',
  'cuit',
  'contactPerson',
  'phone',
  'email',
  'address',
  'city',
  'province',
  'active',
  'openingBalance',
];

const findOwnSupplier = async (id, businessId) => {
  const supplier = await Supplier.findOne({ where: { id, businessId } });
  if (!supplier) throw httpError('Proveedor no encontrado.', 404);
  return supplier;
};

// CUIT: se valida y se guarda con formato (si al editar viene el mismo que ya tenía, no se revisa)
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

const cleanActive = (data) => {
  if ('active' in data) data.active = data.active === true || data.active === 'true';
  return data;
};

// Saldo inicial de la cuenta corriente: vacío = 0
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

export const getSuppliers = asyncHandler(async (req, res) => {
  const suppliers = await Supplier.findAll({ where: { businessId: req.user.businessId } });
  res.json(suppliers);
});

export const createSupplier = asyncHandler(async (req, res) => {
  const supplier = await Supplier.create({
    ...cleanTaxId(cleanOpeningBalance(cleanActive(pick(req.body, SUPPLIER_FIELDS)))),
    businessId: req.user.businessId,
  });
  res.status(201).json(supplier);
});

export const updateSupplier = asyncHandler(async (req, res) => {
  const supplier = await findOwnSupplier(req.params.id, req.user.businessId);
  const previousOpening = Number(supplier.openingBalance);
  const data = cleanTaxId(cleanOpeningBalance(cleanActive(pick(req.body, SUPPLIER_FIELDS))), supplier.cuit);
  await supplier.update(data);
  // Cambiar el saldo inicial mueve la cuenta corriente: queda registrado
  if ('openingBalance' in data && data.openingBalance !== previousOpening) {
    await audit(req, {
      action: 'supplier.opening_balance_changed',
      targetType: 'supplier',
      targetId: supplier.id,
      detail: { from: previousOpening, to: data.openingBalance },
    });
  }
  res.json(supplier);
});

export const deleteSupplier = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const supplier = await findOwnSupplier(req.params.id, businessId);

  // Un proveedor con compras o pagos no se borra: se perdería el historial
  const purchases = await Purchase.count({ where: { supplierId: supplier.id, businessId } });
  const payments = await SupplierPayment.count({ where: { supplierId: supplier.id, businessId } });
  if (payments > 0) {
    throw httpError(
      `${supplier.name} tiene pagos registrados y no se puede eliminar. Si ya no le comprás, editalo y marcalo como inactivo.`,
      409,
    );
  }
  if (purchases > 0) {
    throw httpError(
      `${supplier.name} tiene ${purchases} ${purchases === 1 ? 'compra registrada' : 'compras registradas'} y no se puede eliminar. ` +
        'Si ya no le comprás, editalo y marcalo como inactivo.',
      409,
    );
  }

  await supplier.destroy();
  res.status(204).send();
});
