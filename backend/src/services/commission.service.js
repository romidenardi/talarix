import { User } from '../models/index.js';
import { httpError } from '../utils/httpError.js';
import { round2 } from '../utils/numbers.js';

// Comisiones por venta (opcionales, por usuario).
//   - Cada usuario puede tener un % de comisión (users.commission_rate). Vacío = sin comisión.
//   - Vende quien genera el remito; en una mesa, el mozo que la atendió (el que la abrió), aunque la
//     cobre otro o la pasen de mesa.
//   - La comisión es el % sobre el total final del remito (con descuento e IVA; sin las propinas de
//     las mesas ni el interés de las cuotas).
//   - En el remito queda la foto: vendedor, % e importe. Cambiar el % del usuario no toca los remitos
//     ya hechos, y un remito anulado no cuenta en el reporte.

// % del formulario de Usuarios: vacío o 0 = sin comisión (null); si no, de 0,01 a 100 con dos decimales
export const parseCommissionRate = (value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const rate = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    throw httpError('La comisión tiene que ser un porcentaje entre 0 y 100.');
  }
  return rate === 0 ? null : round2(rate);
};

// Vendedor y comisión de un remito nuevo. seller: { id, name } (el mozo de la mesa) o el usuario que
// lo genera. Si el vendedor ya no existe, queda su nombre y no lleva comisión.
export const commissionFields = async ({ businessId, seller, total, transaction }) => {
  if (!seller?.id)
    return { sellerId: null, sellerName: seller?.name || null, commissionRate: null, commissionAmount: null };
  const user = await User.findOne({
    where: { id: seller.id, businessId },
    attributes: ['id', 'name', 'commissionRate'],
    transaction,
  });
  const rate = user?.commissionRate === null || user?.commissionRate === undefined ? null : Number(user.commissionRate);
  const hasCommission = rate !== null && rate > 0;
  return {
    sellerId: seller.id,
    sellerName: user?.name || seller.name || null,
    commissionRate: hasCommission ? rate : null,
    commissionAmount: hasCommission ? round2((Number(total) * rate) / 100) : null,
  };
};
