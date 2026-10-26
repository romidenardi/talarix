import { Product, ComboItem, Category, sequelize } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { isPositiveInt, toNumber, round2 } from '../utils/numbers.js';
import { computeCombo, withComboData } from '../services/combo.service.js';

// La categoría tiene que ser del mismo comercio (igual que en productos)
const resolveCategoryId = async (categoryId, businessId, transaction) => {
  if (!categoryId) return null;
  const category = await Category.findOne({ where: { id: categoryId, businessId }, transaction });
  if (!category) throw httpError('La categoría no existe', 404);
  return category.id;
};

const parseSpecialPrice = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) throw httpError('El precio especial no es válido');
  return round2(price);
};

const cleanBarcode = (value) => {
  if (value === undefined) return undefined;
  const code = String(value ?? '').trim();
  return code || null;
};

const readComponents = async (raw, businessId, comboId, transaction) => {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw httpError('El combo debe tener al menos un producto');
  }

  const quantities = new Map();
  raw.forEach((component, index) => {
    const n = index + 1;
    if (!component || !component.productId) throw httpError(`Producto ${n}: falta elegir el producto`);
    if (!isPositiveInt(component.quantity)) {
      throw httpError(`Producto ${n}: la cantidad debe ser un entero mayor a 0`);
    }
    quantities.set(component.productId, (quantities.get(component.productId) || 0) + toNumber(component.quantity));
  });

  if (comboId && quantities.has(comboId)) throw httpError('Un combo no puede incluirse a sí mismo');

  const products = await Product.findAll({
    where: { id: [...quantities.keys()], businessId },
    transaction,
  });
  if (products.length !== quantities.size) throw httpError('Alguno de los productos del combo no existe', 404);
  if (products.some((p) => p.isCombo)) throw httpError('Un combo no puede incluir a otro combo');

  return products.map((product) => ({ product, quantity: quantities.get(product.id) }));
};

const rethrowDuplicate = (err) => {
  if (err?.name === 'SequelizeUniqueConstraintError') {
    throw httpError('Ese código de barras ya está asignado a otro producto', 409);
  }
  throw err;
};

const loadCombo = async (id, businessId) => {
  const combo = await Product.findOne({ where: { id, businessId, isCombo: true } });
  if (!combo) throw httpError('Combo no encontrado', 404);
  return combo;
};

const respondWithCombo = async (res, status, comboId, businessId) => {
  const combo = await loadCombo(comboId, businessId);
  const [data] = await withComboData([combo], businessId);
  res.status(status).json(data);
};

export const createCombo = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const { internalCode, name, description, brand, model, categoryId } = req.body;

  if (!internalCode || !String(internalCode).trim()) throw httpError('El código interno es obligatorio');
  if (!name || !String(name).trim()) throw httpError('El nombre del combo es obligatorio');

  const specialPrice = parseSpecialPrice(req.body.specialPrice) ?? null;
  const barcode = cleanBarcode(req.body.barcode) ?? null;

  const t = await sequelize.transaction();
  let comboId;
  try {
    const components = await readComponents(req.body.components, businessId, null, t);
    const calc = computeCombo({ specialPrice }, components);

    const combo = await Product.create(
      {
        businessId,
        internalCode: String(internalCode).trim(),
        barcode,
        name: String(name).trim(),
        description: description || null,
        brand: brand || null,
        model: model || null,
        categoryId: await resolveCategoryId(categoryId, businessId, t),
        unitType: 'unit',
        price: calc.price,
        cost: calc.cost,
        vatRate: 21,
        stock: 0,
        isCombo: true,
        specialPrice,
        active: req.body.active === undefined ? true : Boolean(req.body.active),
      },
      { transaction: t },
    );
    comboId = combo.id;

    await ComboItem.bulkCreate(
      components.map(({ product, quantity }) => ({ comboId: combo.id, productId: product.id, quantity })),
      { transaction: t },
    );

    await t.commit();
  } catch (error) {
    await t.rollback();
    rethrowDuplicate(error);
  }

  await respondWithCombo(res, 201, comboId, businessId);
});

export const updateCombo = asyncHandler(async (req, res) => {
  const { businessId } = req.user;

  const t = await sequelize.transaction();
  try {
    const combo = await Product.findOne({
      where: { id: req.params.id, businessId, isCombo: true },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!combo) throw httpError('Combo no encontrado', 404);

    const changes = {};
    for (const field of ['internalCode', 'name']) {
      if (field in req.body) {
        if (!String(req.body[field] ?? '').trim()) {
          throw httpError(field === 'name' ? 'El nombre del combo es obligatorio' : 'El código interno es obligatorio');
        }
        changes[field] = String(req.body[field]).trim();
      }
    }
    for (const field of ['description', 'brand', 'model']) {
      if (field in req.body) changes[field] = req.body[field] || null;
    }
    if ('categoryId' in req.body) changes.categoryId = await resolveCategoryId(req.body.categoryId, businessId, t);
    if ('barcode' in req.body) changes.barcode = cleanBarcode(req.body.barcode) ?? null;
    if ('active' in req.body) changes.active = Boolean(req.body.active);
    if ('specialPrice' in req.body) changes.specialPrice = parseSpecialPrice(req.body.specialPrice) ?? null;

    let components;
    if ('components' in req.body) {
      components = await readComponents(req.body.components, businessId, combo.id, t);
      await ComboItem.destroy({ where: { comboId: combo.id }, transaction: t });
      await ComboItem.bulkCreate(
        components.map(({ product, quantity }) => ({ comboId: combo.id, productId: product.id, quantity })),
        { transaction: t },
      );
    } else {
      const items = await ComboItem.findAll({ where: { comboId: combo.id }, transaction: t });
      const products = await Product.findAll({
        where: { id: items.map((i) => i.productId), businessId },
        transaction: t,
      });
      const byId = new Map(products.map((p) => [p.id, p]));
      components = items
        .filter((i) => byId.has(i.productId))
        .map((i) => ({ product: byId.get(i.productId), quantity: Number(i.quantity) }));
    }

    const specialPrice = 'specialPrice' in changes ? changes.specialPrice : combo.specialPrice;
    const calc = computeCombo({ specialPrice }, components);
    await combo.update({ ...changes, price: calc.price, cost: calc.cost }, { transaction: t });

    await t.commit();
  } catch (error) {
    await t.rollback();
    rethrowDuplicate(error);
  }

  await respondWithCombo(res, 200, req.params.id, businessId);
});

export const deleteCombo = asyncHandler(async (req, res) => {
  const combo = await loadCombo(req.params.id, req.user.businessId);
  const t = await sequelize.transaction();
  try {
    await ComboItem.destroy({ where: { comboId: combo.id }, transaction: t });
    await combo.destroy({ transaction: t });
    await t.commit();
  } catch (err) {
    await t.rollback();
    if (err?.name === 'SequelizeForeignKeyConstraintError') {
      throw httpError('No se puede eliminar: el combo ya se vendió en remitos. Podés dejarlo inactivo.', 409);
    }
    throw err;
  }
  res.status(204).send();
});
