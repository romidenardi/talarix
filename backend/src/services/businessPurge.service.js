import {
  sequelize,
  Business,
  Category,
  Product,
  StockMovement,
  Payment,
  InstallmentPlan,
  User,
  Customer,
  Supplier,
  Purchase,
  PurchaseItem,
  Order,
  OrderItem,
  ComboItem,
  ClosureRecord,
  AuditLog,
} from '../models/index.js';
import { audit } from '../utils/audit.js';

const CHUNK_SIZE = 500;

const idsOf = async (Model, where, transaction) =>
  (await Model.findAll({ where, attributes: ['id'], raw: true, transaction })).map((row) => row.id);

const destroyByIds = async (Model, field, ids, transaction) => {
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    await Model.destroy({
      where: { [field]: ids.slice(i, i + CHUNK_SIZE) },
      force: true,
      transaction,
    });
  }
};

export const purgeBusiness = async (businessId) => {
  const business = await Business.findByPk(businessId);
  if (!business) throw new Error('Comercio no encontrado');
  if (business.type === 'demo') throw new Error('La cuenta demo no puede eliminar');
  if (business.status !== 'closing') throw new Error('El comercio no tiene una baja pendiente');
  if (!business.deleteAt || business.deleteAt > new Date()) {
    throw new Error('Todavía no venció el plazo de la baja');
  }

  const transaction = await sequelize.transaction();
  try {
    const orderIds = await idsOf(Order, { businessId }, transaction);
    await destroyByIds(OrderItem, 'orderId', orderIds, transaction);
    await Order.destroy({ where: { businessId }, force: true, transaction });

    const purchaseIds = await idsOf(Purchase, { businessId }, transaction);
    await destroyByIds(PurchaseItem, 'purchaseId', purchaseIds, transaction);
    await Purchase.destroy({ where: { businessId }, force: true, transaction });

    const productIds = await idsOf(Product, { businessId }, transaction);
    await destroyByIds(StockMovement, 'productId', productIds, transaction);
    await destroyByIds(ComboItem, 'comboId', productIds, transaction);
    await destroyByIds(ComboItem, 'productId', productIds, transaction);
    await Product.destroy({ where: { businessId }, force: true, transaction });

    await Category.update({ parentId: null }, { where: { businessId }, transaction });
    await Category.destroy({ where: { businessId }, force: true, transaction });

    const paymentIds = await idsOf(Payment, { businessId }, transaction);
    await destroyByIds(InstallmentPlan, 'paymentId', paymentIds, transaction);
    await Payment.destroy({ where: { businessId }, force: true, transaction });

    await Customer.destroy({ where: { businessId }, force: true, transaction });
    await Supplier.destroy({ where: { businessId }, force: true, transaction });
    const userCount = await User.count({ where: { businessId }, transaction });
    await User.destroy({ where: { businessId }, force: true, transaction });

    await ClosureRecord.create(
      {
        businessId,
        businessName: business.name,
        scheduledFor: business.deleteAt,
        deletedAt: new Date(),
        userCount,
      },
      { transaction },
    );
    // El registro de auditoría del comercio también se borra (tiene ids de usuarios e IP);
    // queda solo la constancia del borrado, sin datos personales
    await AuditLog.destroy({ where: { businessId }, transaction });
    await business.destroy({ force: true, transaction });

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  await audit(null, {
    action: 'business.purged',
    actorType: 'system',
    businessId,
    targetType: 'business',
    targetId: businessId,
  });
};
