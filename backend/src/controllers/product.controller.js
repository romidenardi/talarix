import pkg from 'sequelize';
import { Product, ComboItem, Category, OrderItem, PurchaseItem, Order, Purchase } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { withComboData } from '../services/combo.service.js';
import { pick } from '../utils/pick.js';

const { Op } = pkg;

const cleanBarcode = (value) => {
  if (value === undefined) return undefined;
  const code = String(value ?? '').trim();
  return code || null;
};

const assertBarcodeFree = async (businessId, barcode, exceptId) => {
  if (!barcode) return;
  const where = { businessId, barcode };
  if (exceptId) where.id = { [Op.ne]: exceptId };
  const existing = await Product.findOne({ where });
  if (existing) {
    throw httpError(`El código de barras ya está asignado a "${existing.name}"`, 409);
  }
};

// PLU de balanza: entero entre 1 y 9999 (vacío = sin PLU)
const cleanScalePlu = (value) => {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') return null;
  const plu = Number(value);
  if (!Number.isInteger(plu) || plu < 1 || plu > 9999) {
    throw httpError('El PLU de balanza debe ser un número entero entre 1 y 9999');
  }
  return plu;
};

const assertScalePluFree = async (businessId, scalePlu, exceptId) => {
  if (!scalePlu) return;
  const where = { businessId, scalePlu };
  if (exceptId) where.id = { [Op.ne]: exceptId };
  const existing = await Product.findOne({ where });
  if (existing) {
    throw httpError(`El PLU de balanza ${scalePlu} ya está asignado a "${existing.name}"`, 409);
  }
};

const rethrowDuplicate = (err) => {
  if (err?.name === 'SequelizeUniqueConstraintError') {
    const detail = `${err?.parent?.sqlMessage || err?.original?.sqlMessage || ''} ${Object.keys(err?.fields || {}).join(' ')}`;
    if (/scale_plu/i.test(detail)) {
      throw httpError('Ese PLU de balanza ya está asignado a otro producto', 409);
    }
    throw httpError('Ese código de barras ya está asignado a otro producto', 409);
  }
  throw err;
};

// Campos que se pueden cargar o editar desde la API. El stock no está: solo cambia con
// movimientos de stock, compras y remitos. Tampoco businessId, id, isCombo ni specialPrice.
const PRODUCT_FIELDS = [
  'internalCode',
  'barcode',
  'scalePlu',
  'name',
  'description',
  'brand',
  'model',
  'unitType',
  'price',
  'promoPrice',
  'cost',
  'fiscalActivity',
  'vatRate',
  'otherTaxes',
  'categoryId',
  'active',
];

// La categoría tiene que ser del mismo comercio
const resolveCategoryId = async (categoryId, businessId) => {
  if (!categoryId) return null;
  const category = await Category.findOne({ where: { id: categoryId, businessId } });
  if (!category) throw httpError('La categoría no existe', 404);
  return category.id;
};

const cleanPromoPrice = (data) => {
  if ('promoPrice' in data && (data.promoPrice === '' || data.promoPrice === null)) data.promoPrice = null;
  return data;
};

const ALLOWED_VAT_RATES = [0, 10.5, 21];

const normalizeTaxes = (data, currentVat) => {
  if ('vatRate' in data && data.vatRate !== undefined && data.vatRate !== null && data.vatRate !== '') {
    const rate = Number(data.vatRate);
    const unchanged = currentVat !== undefined && Number(currentVat) === rate;
    if (!Number.isFinite(rate) || (!ALLOWED_VAT_RATES.includes(rate) && !unchanged)) {
      throw httpError('El IVA debe ser 21%, 10,5% o 0%');
    }
    data.vatRate = rate;
  }

  if ('otherTaxes' in data) {
    if (data.otherTaxes === '' || data.otherTaxes === null || data.otherTaxes === undefined) {
      data.otherTaxes = null;
    } else {
      const internal = Number(data.otherTaxes);
      if (!Number.isFinite(internal) || internal < 0 || internal > 100) {
        throw httpError('Los impuestos internos deben ser un porcentaje entre 0 y 100');
      }
      data.otherTaxes = internal;
    }
  }
  return data;
};

const findOwnProduct = async (id, businessId) => {
  const product = await Product.findOne({ where: { id, businessId } });
  if (!product) throw httpError('Producto no encontrado', 404);
  return product;
};

export const getProducts = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const products = await Product.findAll({ where: { businessId } });
  res.json(await withComboData(products, businessId));
});

export const getProductByBarcode = asyncHandler(async (req, res) => {
  const barcode = cleanBarcode(req.params.barcode);
  const product = barcode ? await Product.findOne({ where: { barcode, businessId: req.user.businessId } }) : null;
  if (!product) throw httpError('Producto no encontrado', 404);
  const [data] = await withComboData([product], req.user.businessId);
  res.json(data);
});

export const createProduct = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const barcode = cleanBarcode(req.body.barcode) ?? null;
  await assertBarcodeFree(businessId, barcode);

  const scalePlu = cleanScalePlu(req.body.scalePlu) ?? null;
  if (scalePlu && req.body.unitType !== 'weight') {
    throw httpError('El PLU de balanza solo se puede asignar a productos por peso');
  }
  await assertScalePluFree(businessId, scalePlu);

  // Los combos se crean desde /combos: acá nunca
  const data = cleanPromoPrice(normalizeTaxes(pick(req.body, PRODUCT_FIELDS)));
  data.categoryId = await resolveCategoryId(data.categoryId, businessId);

  let product;
  try {
    product = await Product.create({ ...data, barcode, scalePlu, businessId });
  } catch (err) {
    rethrowDuplicate(err);
  }
  res.status(201).json(product);
});

export const updateProduct = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const product = await findOwnProduct(req.params.id, businessId);

  if (product.isCombo) throw httpError('Los combos se editan desde la pestaña Combos', 400);

  // Solo los campos editables: nunca el comercio, el id ni el stock
  const data = cleanPromoPrice(normalizeTaxes(pick(req.body, PRODUCT_FIELDS), product.vatRate));
  if ('categoryId' in data) data.categoryId = await resolveCategoryId(data.categoryId, businessId);

  if ('barcode' in data) {
    data.barcode = cleanBarcode(data.barcode) ?? null;
    await assertBarcodeFree(businessId, data.barcode, product.id);
  }

  const finalUnitType = data.unitType ?? product.unitType;
  if ('scalePlu' in data) data.scalePlu = cleanScalePlu(data.scalePlu) ?? null;
  if (finalUnitType !== 'weight') {
    if (data.scalePlu) throw httpError('El PLU de balanza solo se puede asignar a productos por peso');
    // Si el producto deja de ser por peso, pierde su PLU
    if (product.scalePlu) data.scalePlu = null;
  }
  if (data.scalePlu) await assertScalePluFree(businessId, data.scalePlu, product.id);

  try {
    await product.update(data);
  } catch (err) {
    rethrowDuplicate(err);
  }
  res.json(product);
});

export const deleteProduct = asyncHandler(async (req, res) => {
  const product = await findOwnProduct(req.params.id, req.user.businessId);
  if (product.isCombo) throw httpError('Los combos se eliminan desde la pestaña Combos', 400);

  const usedIn = await ComboItem.findAll({
    where: { productId: product.id },
    include: [{ model: Product, as: 'combo', attributes: ['name'] }],
  });
  if (usedIn.length) {
    const names = usedIn.map((item) => `"${item.combo?.name}"`).join(', ');
    throw httpError(`No se puede eliminar: forma parte de los combos ${names}`, 409);
  }

  // Un producto que ya se vendió o se compró no se borra: se perdería el historial
  const [sold, bought] = await Promise.all([
    Order.count({
      where: { businessId: product.businessId },
      include: [{ model: OrderItem, as: 'items', attributes: [], where: { productId: product.id } }],
      distinct: true,
    }),
    Purchase.count({
      where: { businessId: product.businessId },
      include: [{ model: PurchaseItem, as: 'items', attributes: [], where: { productId: product.id } }],
      distinct: true,
    }),
  ]);
  if (sold > 0 || bought > 0) {
    const parts = [
      sold > 0 && `${sold} ${sold === 1 ? 'remito' : 'remitos'}`,
      bought > 0 && `${bought} ${bought === 1 ? 'compra' : 'compras'}`,
    ]
      .filter(Boolean)
      .join(' y ');
    throw httpError(
      `"${product.name}" aparece en ${parts} y no se puede eliminar, porque se perdería el historial. ` +
        'Si ya no lo vendés, editalo y marcalo como inactivo.',
      409,
    );
  }

  await product.destroy();
  res.status(204).send();
});
