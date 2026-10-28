import pkg from 'sequelize';
import {
  Product,
  ComboItem,
  Category,
  OrderItem,
  PurchaseItem,
  Order,
  Purchase,
  TabItem,
  sequelize,
} from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { withComboData } from '../services/combo.service.js';
import { pick } from '../utils/pick.js';
import {
  MAX_VARIANTS,
  isVariantGroup,
  isVariant,
  variantName,
  inheritedFields,
  normalizeAttributes,
  normalizeValues,
  assertNewCombinations,
  PRICE_FIELDS,
} from '../services/variant.service.js';

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

// Lo que se puede cambiar en una variante: lo demás lo toma del producto principal
const VARIANT_FIELDS = ['internalCode', 'barcode', 'price', 'promoPrice', 'cost', 'active'];

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

// Variantes nuevas de un producto principal. items: [{ values, internalCode?, barcode?, price? }]
// `existing`: las variantes que ya tiene, para no repetir combinaciones ni códigos.
const createVariants = async ({ parent, items, existing = [], businessId, transaction }) => {
  if (!Array.isArray(items) || !items.length) throw httpError('Agregá al menos una variante');
  if (existing.length + items.length > MAX_VARIANTS) {
    throw httpError(`Un producto puede tener hasta ${MAX_VARIANTS} variantes`);
  }
  const attributes = parent.variantAttributes;
  const rows = items.map((item) => ({ ...item, values: normalizeValues(item?.values, attributes) }));
  assertNewCombinations(
    rows.map((r) => r.values),
    existing.map((v) => v.variantValues || []),
  );

  const barcodes = new Set();
  let next = existing.length + 1;
  const created = [];
  for (const row of rows) {
    const barcode = cleanBarcode(row.barcode) ?? null;
    if (barcode) {
      if (barcodes.has(barcode)) throw httpError(`El código de barras ${barcode} está repetido`, 409);
      barcodes.add(barcode);
      await assertBarcodeFree(businessId, barcode);
    }
    const ownPrice = row.price !== undefined && row.price !== null && row.price !== '';
    const price = ownPrice ? Number(row.price) : Number(parent.price);
    if (!Number.isFinite(price) || price < 0) throw httpError('El precio de la variante debe ser un número positivo');
    const internalCode = String(row.internalCode ?? '').trim() || `${parent.internalCode}-${next}`;
    next += 1;
    created.push(
      await Product.create(
        {
          ...inheritedFields(parent),
          businessId,
          parentId: parent.id,
          variantValues: row.values,
          name: variantName(parent.name, row.values),
          internalCode,
          barcode,
          unitType: 'unit',
          cost: parent.cost,
          active: parent.active,
          ownPrice,
          ...(ownPrice ? { price, promoPrice: null } : {}),
        },
        { transaction },
      ),
    );
  }
  return created;
};

export const createProduct = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const variants = req.body.variants;

  // Los combos se crean desde /combos: acá nunca
  const data = cleanPromoPrice(normalizeTaxes(pick(req.body, PRODUCT_FIELDS)));
  data.categoryId = await resolveCategoryId(data.categoryId, businessId);

  if (variants) {
    if (data.unitType !== 'unit') throw httpError('Las variantes son solo para productos que se venden por unidad');
    const attributes = normalizeAttributes(variants.attributes);
    const t = await sequelize.transaction();
    let parent;
    try {
      parent = await Product.create(
        { ...data, barcode: null, scalePlu: null, businessId, variantAttributes: attributes },
        { transaction: t },
      );
      const created = await createVariants({ parent, items: variants.items, businessId, transaction: t });
      await t.commit();
      return res.status(201).json({ ...parent.toJSON(), variants: created });
    } catch (err) {
      await t.rollback();
      rethrowDuplicate(err);
    }
  }

  const barcode = cleanBarcode(req.body.barcode) ?? null;
  await assertBarcodeFree(businessId, barcode);

  const scalePlu = cleanScalePlu(req.body.scalePlu) ?? null;
  if (scalePlu && req.body.unitType !== 'weight') {
    throw httpError('El PLU de balanza solo se puede asignar a productos por peso');
  }
  await assertScalePluFree(businessId, scalePlu);

  let product;
  try {
    product = await Product.create({ ...data, barcode, scalePlu, businessId });
  } catch (err) {
    rethrowDuplicate(err);
  }
  res.status(201).json(product);
});

// Variantes nuevas para un producto principal que ya existe (por ejemplo, un color nuevo)
export const addVariants = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const parent = await findOwnProduct(req.params.id, businessId);
  if (!isVariantGroup(parent)) throw httpError('Este producto no tiene variantes', 400);

  const t = await sequelize.transaction();
  try {
    const existing = await Product.findAll({ where: { businessId, parentId: parent.id }, transaction: t });
    const created = await createVariants({ parent, items: req.body.items, existing, businessId, transaction: t });
    await t.commit();
    res.status(201).json(created);
  } catch (err) {
    await t.rollback();
    rethrowDuplicate(err);
  }
});

// Producto principal: cambia los datos comunes y los pasa a sus variantes
const updateGroup = async (parent, body, businessId) => {
  const data = cleanPromoPrice(normalizeTaxes(pick(body, PRODUCT_FIELDS), parent.vatRate));
  delete data.barcode;
  delete data.scalePlu;
  if (data.unitType && data.unitType !== 'unit') {
    throw httpError('Un producto con variantes se vende por unidad');
  }
  if ('categoryId' in data) data.categoryId = await resolveCategoryId(data.categoryId, businessId);
  if (body.variantAttributes !== undefined) {
    const names = normalizeAttributes(body.variantAttributes);
    if (names.length !== parent.variantAttributes.length) {
      throw httpError('Se pueden cambiar los nombres de los atributos, pero no agregar ni quitar atributos');
    }
    data.variantAttributes = names;
  }

  const previousCost = Number(parent.cost);
  const t = await sequelize.transaction();
  try {
    await parent.update(data, { transaction: t });
    const variants = await Product.findAll({ where: { businessId, parentId: parent.id }, transaction: t });
    for (const variant of variants) {
      const changes = inheritedFields(parent, { withPrice: !variant.ownPrice });
      changes.name = variantName(parent.name, variant.variantValues || []);
      if ('active' in data) changes.active = parent.active;
      // El costo pasa solo a las variantes que todavía tenían el mismo costo (las compras lo cambian en cada una)
      if ('cost' in data && Number(variant.cost) === previousCost) changes.cost = parent.cost;
      await variant.update(changes, { transaction: t });
    }
    await t.commit();
  } catch (err) {
    await t.rollback();
    rethrowDuplicate(err);
  }
  return parent;
};

// Variante: código, código de barras, precio propio, costo, estado y sus valores
const updateVariant = async (variant, body, businessId) => {
  const parent = await Product.findOne({ where: { id: variant.parentId, businessId } });
  if (!parent) throw httpError('No se encontró el producto principal de esta variante', 404);

  const data = cleanPromoPrice(pick(body, VARIANT_FIELDS));
  if ('internalCode' in data) data.internalCode = String(data.internalCode ?? '').trim();
  if ('barcode' in data) {
    data.barcode = cleanBarcode(data.barcode) ?? null;
    await assertBarcodeFree(businessId, data.barcode, variant.id);
  }

  if (body.ownPrice === false) {
    // Vuelve a tomar el precio y la promo del principal
    for (const field of PRICE_FIELDS) data[field] = parent[field] ?? null;
    data.ownPrice = false;
  } else if (PRICE_FIELDS.some((f) => f in data)) {
    data.ownPrice = true;
  }

  if (data.active === true && !parent.active) {
    throw httpError('El producto principal está inactivo: activalo primero');
  }

  if (body.variantValues !== undefined) {
    const values = normalizeValues(body.variantValues, parent.variantAttributes);
    const siblings = await Product.findAll({
      where: { businessId, parentId: parent.id, id: { [Op.ne]: variant.id } },
      attributes: ['variantValues'],
    });
    assertNewCombinations(
      [values],
      siblings.map((s) => s.variantValues || []),
    );
    data.variantValues = values;
    data.name = variantName(parent.name, values);
  }

  try {
    await variant.update(data);
  } catch (err) {
    rethrowDuplicate(err);
  }
  return variant;
};

export const updateProduct = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const product = await findOwnProduct(req.params.id, businessId);

  if (product.isCombo) throw httpError('Los combos se editan desde la pestaña Combos', 400);
  if (isVariantGroup(product)) return res.json(await updateGroup(product, req.body, businessId));
  if (isVariant(product)) return res.json(await updateVariant(product, req.body, businessId));

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

// Por qué no se puede borrar un producto (o null si se puede): está en un combo o tiene historial
const deleteBlocker = async (product) => {
  const usedIn = await ComboItem.findAll({
    where: { productId: product.id },
    include: [{ model: Product, as: 'combo', attributes: ['name'] }],
  });
  if (usedIn.length) {
    const names = usedIn.map((item) => `"${item.combo?.name}"`).join(', ');
    return `"${product.name}" forma parte de los combos ${names}`;
  }

  // Un producto que ya se vendió, se compró o se pidió en una mesa no se borra: se perdería el historial
  const [sold, bought, ordered] = await Promise.all([
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
    TabItem.count({ where: { businessId: product.businessId, productId: product.id } }),
  ]);
  if (sold > 0 || bought > 0 || ordered > 0) {
    const parts = [
      sold > 0 && `${sold} ${sold === 1 ? 'remito' : 'remitos'}`,
      bought > 0 && `${bought} ${bought === 1 ? 'compra' : 'compras'}`,
      !sold && ordered > 0 && 'comandas de mesas',
    ]
      .filter(Boolean)
      .join(' y ');
    return `"${product.name}" aparece en ${parts}`;
  }
  return null;
};

export const deleteProduct = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const product = await findOwnProduct(req.params.id, businessId);
  if (product.isCombo) throw httpError('Los combos se eliminan desde la pestaña Combos', 400);

  if (isVariantGroup(product)) {
    const variants = await Product.findAll({ where: { businessId, parentId: product.id } });
    for (const variant of variants) {
      const blocker = await deleteBlocker(variant);
      if (blocker) {
        throw httpError(
          `No se puede eliminar "${product.name}": ${blocker}. Si ya no lo vendés, editalo y marcalo como inactivo.`,
          409,
        );
      }
    }
    await sequelize.transaction(async (t) => {
      await Product.destroy({ where: { businessId, parentId: product.id }, transaction: t });
      await product.destroy({ transaction: t });
    });
    return res.status(204).send();
  }

  const blocker = await deleteBlocker(product);
  if (blocker) {
    const inCombo = blocker.includes('combos');
    throw httpError(
      inCombo
        ? `No se puede eliminar: ${blocker}`
        : `${blocker} y no se puede eliminar, porque se perdería el historial. ` +
            'Si ya no lo vendés, editalo y marcalo como inactivo.',
      409,
    );
  }

  await product.destroy();
  res.status(204).send();
});
