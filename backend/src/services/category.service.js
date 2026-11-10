import { Category } from '../models/index.js';
import { httpError } from '../utils/httpError.js';

// Categoría de un producto, combo o plato: tiene que ser del mismo comercio y no puede ser un rubro
// que tiene subcategorías (el producto va en una de ellas). Una categoría sin subcategorías, de
// primer nivel o no, se puede elegir.
// current: la categoría que ya tenía. Si no cambia, se acepta aunque después se le hayan creado
// subcategorías, para poder editar otros datos sin que obligue a recategorizar.
export const resolveProductCategory = async (categoryId, businessId, { current = null, transaction } = {}) => {
  if (!categoryId) return null;
  const category = await Category.findOne({ where: { id: categoryId, businessId }, transaction });
  if (!category) throw httpError('La categoría no existe.', 404);
  if (category.id === current) return category.id;

  const subcategories = await Category.count({ where: { parentId: category.id, businessId }, transaction });
  if (subcategories > 0) {
    throw httpError(`${category.name} tiene subcategorías: elegí una de ellas.`);
  }
  return category.id;
};
