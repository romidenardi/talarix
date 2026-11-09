import { Category } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { pick } from '../utils/pick.js';

const findOwnCategory = async (id, businessId) => {
  const category = await Category.findOne({ where: { id, businessId } });
  if (!category) throw httpError('Categoría no encontrada.', 404);
  return category;
};

// La categoría padre tiene que ser del mismo comercio y de primer nivel (hay solo dos niveles)
const resolveParentId = async (parentId, businessId, selfId) => {
  if (!parentId) return null;
  if (selfId && parentId === selfId) throw httpError('Una categoría no puede ser su propia categoría padre.');

  const parent = await Category.findOne({ where: { id: parentId, businessId } });
  if (!parent) throw httpError('La categoría padre no existe.', 404);
  if (parent.parentId) throw httpError('La categoría padre tiene que ser de primer nivel.');

  if (selfId) {
    const children = await Category.count({ where: { parentId: selfId, businessId } });
    if (children > 0) {
      throw httpError('Esta categoría tiene subcategorías: no puede ser subcategoría de otra.');
    }
  }
  return parent.id;
};

export const getCategories = asyncHandler(async (req, res) => {
  const categories = await Category.findAll({
    where: { businessId: req.user.businessId },
    include: [{ model: Category, as: 'subcategories' }],
  });
  res.json(categories);
});

export const createCategory = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const { name, parentId } = req.body;
  const category = await Category.create({
    name,
    parentId: await resolveParentId(parentId, businessId),
    businessId,
  });
  res.status(201).json(category);
});

export const updateCategory = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const category = await findOwnCategory(req.params.id, businessId);

  const data = pick(req.body, ['name', 'parentId']);
  if ('parentId' in data) data.parentId = await resolveParentId(data.parentId, businessId, category.id);

  await category.update(data);
  res.json(category);
});

export const deleteCategory = asyncHandler(async (req, res) => {
  // Los productos de la categoría quedan "sin categoría" y sus subcategorías pasan a primer nivel
  const category = await findOwnCategory(req.params.id, req.user.businessId);
  await category.destroy();
  res.status(204).send();
});
