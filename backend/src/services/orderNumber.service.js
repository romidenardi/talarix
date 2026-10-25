import pkg from 'sequelize';
import { Business, sequelize } from '../models/index.js';

const { QueryTypes } = pkg;

// Número de remito correlativo por comercio: 1, 2, 3… Los anulados conservan su número.
// Se bloquea la fila del comercio durante la transacción, así dos remitos que se generan al mismo
// tiempo no pueden tomar el mismo número (además, uq_orders_business_number lo impide en la base).
//
// Ojo: el máximo se lee con FOR UPDATE a propósito. Una lectura común dentro de la transacción
// usaría la "foto" de la base del principio de la transacción (REPEATABLE READ de MySQL) y no
// vería el remito que otro acaba de guardar mientras esta esperaba el bloqueo.
export const nextOrderNumber = async (businessId, transaction) => {
  await Business.findOne({
    where: { id: businessId },
    attributes: ['id'],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  const [row] = await sequelize.query(
    'SELECT MAX(`number`) AS maxNumber FROM orders WHERE business_id = :businessId FOR UPDATE',
    { replacements: { businessId }, type: QueryTypes.SELECT, transaction }
  );
  return (Number(row?.maxNumber) || 0) + 1;
};

// Cómo se muestra: 00000123. Un remito sin número (no debería haber) muestra el comienzo del id.
export const formatOrderNumber = (order) =>
  (order.number ? String(order.number).padStart(8, '0') : String(order.id).slice(0, 8).toUpperCase());
