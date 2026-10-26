import { Product, StockMovement } from '../models/index.js';
import { httpError } from '../utils/httpError.js';
import { round3, unitWord } from '../utils/numbers.js';

// Único lugar del sistema que cambia el stock de un producto. Cada cambio deja su movimiento, con
// quién lo hizo, así que no hay forma de tocar el stock "por atrás".

// Bloquea los productos para la transacción (SELECT … FOR UPDATE) SIEMPRE ordenados por id.
// Si dos ventas con los mismos productos cargados en distinto orden llegan juntas, las dos los
// piden en el mismo orden: una espera a la otra en lugar de trabarse (deadlock).
export const lockProducts = async (ids, businessId, transaction) => {
  const unique = [...new Set(ids)].sort();
  if (!unique.length) return new Map();
  const products = await Product.findAll({
    where: { id: unique, businessId },
    order: [['id', 'ASC']],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  return new Map(products.map((p) => [p.id, p]));
};

// Quién hizo el cambio: se guarda el id y también el nombre, por si después se borra el usuario
export const actorFields = (user) => ({
  createdById: user?.id ?? null,
  createdByName: user?.name ? String(user.name).slice(0, 100) : null,
});

// Suma (delta > 0) o resta (delta < 0) stock y deja el movimiento.
//   type: 'in' | 'out' | 'adjustment'
//   allowNegative: solo para casos excepcionales; por defecto el stock nunca queda negativo
export const moveStock = async (
  { product, type, delta, reason = null, actor = null, date = null, allowNegative = false },
  transaction,
) => {
  const amount = round3(Number(delta));
  const newStock = round3(Number(product.stock) + amount);
  if (newStock < 0 && !allowNegative) {
    throw httpError(
      `Stock insuficiente para ${product.name} (disponible: ${Number(product.stock)} ${unitWord(product)}, ` +
        `se necesitan ${Math.abs(amount)})`,
    );
  }

  const movement = await StockMovement.create(
    {
      businessId: product.businessId,
      productId: product.id,
      type,
      quantity: amount,
      reason: reason ? String(reason).slice(0, 255) : null,
      ...(date ? { date } : {}),
      ...actorFields(actor),
    },
    { transaction },
  );

  product.stock = newStock;
  await product.save({ transaction });
  return movement;
};
