import pkg from 'sequelize';
import { sequelize, Product, Category, MenuItemExtra, TabItem, OrderItem } from '../models/index.js';
import { httpError } from '../utils/httpError.js';
import { isNonNegative, toNumber, round2 } from '../utils/numbers.js';

// Menú de las mesas. Platos (menu_kind = 'dish') y adicionales (menu_kind = 'extra') son productos
// sin control de stock, así el remito, los reportes y el IVA los tratan como cualquier producto.
// Un adicional se carga una vez y se asigna a varios platos (menu_item_extras). En la mesa solo se
// piden platos del menú, cada uno con los adicionales que se elijan.

const { Op } = pkg;
const MAX_PRICE = 99999999;
const MENU_VAT = 21;

const readPrice = (value, label, { optional = false } = {}) => {
  if (optional && (value === undefined || value === null || value === '')) return null;
  if (!isNonNegative(value) || toNumber(value) > MAX_PRICE) throw httpError(`${label} debe ser un número positivo.`);
  return round2(toNumber(value));
};

const readText = (value, label, max = 255) => {
  const text = String(value ?? '').trim();
  if (!text) throw httpError(`${label} es obligatorio.`);
  if (text.length > max) throw httpError(`${label} puede tener hasta ${max} caracteres.`);
  return text;
};

const resolveCategory = async (categoryId, businessId) => {
  if (!categoryId) return null;
  const category = await Category.findOne({ where: { id: categoryId, businessId } });
  if (!category) throw httpError('La categoría no existe.', 404);
  return category.id;
};

const findMenuItem = async (id, businessId, kind, transaction) => {
  const item = await Product.findOne({ where: { id, businessId, menuKind: kind }, transaction });
  if (!item) throw httpError(kind === 'dish' ? 'Plato no encontrado.' : 'Adicional no encontrado.', 404);
  return item;
};

// Reemplaza los adicionales de un plato por los de la lista
const setDishExtras = async (dish, extraIds, transaction) => {
  if (!Array.isArray(extraIds)) throw httpError('Los adicionales no son válidos.');
  const ids = [...new Set(extraIds.filter((id) => typeof id === 'string' && id))];
  if (ids.length) {
    const extras = await Product.count({
      where: { id: ids, businessId: dish.businessId, menuKind: 'extra' },
      transaction,
    });
    if (extras !== ids.length) throw httpError('Alguno de los adicionales no existe.', 404);
  }
  await MenuItemExtra.destroy({ where: { dishId: dish.id }, transaction });
  if (ids.length) {
    await MenuItemExtra.bulkCreate(
      ids.map((extraId) => ({ businessId: dish.businessId, dishId: dish.id, extraId })),
      { transaction },
    );
  }
};

export const listMenu = async (businessId) => {
  const [items, links] = await Promise.all([
    Product.findAll({
      where: { businessId, menuKind: { [Op.ne]: null } },
      order: [['name', 'ASC']],
    }),
    MenuItemExtra.findAll({ where: { businessId }, attributes: ['dishId', 'extraId'] }),
  ]);
  const extrasOf = new Map();
  for (const link of links) {
    if (!extrasOf.has(link.dishId)) extrasOf.set(link.dishId, []);
    extrasOf.get(link.dishId).push(link.extraId);
  }
  return {
    dishes: items
      .filter((p) => p.menuKind === 'dish')
      .map((p) => ({ ...p.toJSON(), extraIds: extrasOf.get(p.id) || [] })),
    extras: items.filter((p) => p.menuKind === 'extra'),
  };
};

const menuProductFields = (kind) => ({
  menuKind: kind,
  trackStock: false,
  unitType: 'unit',
  cost: 0,
  vatRate: MENU_VAT,
  stock: 0,
});

const readDish = async (body, businessId, partial) => {
  const data = {};
  if (!partial || body.internalCode !== undefined) data.internalCode = readText(body.internalCode, 'El código', 50);
  if (!partial || body.name !== undefined) data.name = readText(body.name, 'El nombre');
  if (!partial || body.price !== undefined) data.price = readPrice(body.price, 'El precio');
  if (body.promoPrice !== undefined)
    data.promoPrice = readPrice(body.promoPrice, 'El precio promo', { optional: true });
  if (body.categoryId !== undefined) data.categoryId = await resolveCategory(body.categoryId, businessId);
  if (body.active !== undefined) data.active = Boolean(body.active);
  return data;
};

const readExtra = (body, partial) => {
  const data = {};
  if (!partial || body.name !== undefined) data.name = readText(body.name, 'El nombre');
  if (!partial || body.price !== undefined) data.price = readPrice(body.price, 'El precio');
  if (body.internalCode !== undefined && String(body.internalCode).trim()) {
    data.internalCode = readText(body.internalCode, 'El código', 50);
  }
  if (body.active !== undefined) data.active = Boolean(body.active);
  return data;
};

// Dos platos no pueden compartir código: es lo que el mozo busca al pedir
const ensureFreeCode = async (internalCode, businessId, exceptId) => {
  if (internalCode === undefined) return;
  const where = { businessId, menuKind: 'dish', internalCode };
  if (exceptId) where.id = { [Op.ne]: exceptId };
  const other = await Product.findOne({ where, attributes: ['name'] });
  if (other) throw httpError(`El código ${internalCode} ya es de "${other.name}".`, 409);
};

export const createDish = async (body, businessId) => {
  const data = await readDish(body, businessId, false);
  await ensureFreeCode(data.internalCode, businessId);
  return sequelize.transaction(async (t) => {
    const dish = await Product.create({ ...menuProductFields('dish'), ...data, businessId }, { transaction: t });
    if (body.extraIds !== undefined) await setDishExtras(dish, body.extraIds, t);
    return dish;
  });
};

export const updateDish = async (id, body, businessId) => {
  const data = await readDish(body, businessId, true);
  await ensureFreeCode(data.internalCode, businessId, id);
  return sequelize.transaction(async (t) => {
    const dish = await findMenuItem(id, businessId, 'dish', t);
    await dish.update(data, { transaction: t });
    if (body.extraIds !== undefined) await setDishExtras(dish, body.extraIds, t);
    return dish;
  });
};

export const createExtra = async (body, businessId) => {
  const data = readExtra(body, false);
  const count = await Product.count({ where: { businessId, menuKind: 'extra' } });
  return Product.create({
    ...menuProductFields('extra'),
    internalCode: `ADI-${count + 1}`,
    ...data,
    businessId,
  });
};

export const updateExtra = async (id, body, businessId) => {
  const extra = await findMenuItem(id, businessId, 'extra');
  await extra.update(readExtra(body, true));
  return extra;
};

// Un plato o adicional que ya se pidió no se borra (historial): se desactiva
export const deleteMenuItem = async (id, businessId, kind) => {
  const item = await findMenuItem(id, businessId, kind);
  const [ordered, sold] = await Promise.all([
    TabItem.count({ where: { businessId, productId: item.id } }),
    OrderItem.count({ where: { productId: item.id } }),
  ]);
  if (ordered || sold) {
    throw httpError(
      `"${item.name}" ya se pidió en una mesa y no se puede eliminar. Si no lo usás más, desactivalo.`,
      409,
    );
  }
  await sequelize.transaction(async (t) => {
    await MenuItemExtra.destroy({
      where: kind === 'dish' ? { dishId: item.id } : { extraId: item.id },
      transaction: t,
    });
    await item.destroy({ transaction: t });
  });
};
