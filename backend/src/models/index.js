import sequelize from '../config/database.js';
import Business from './business.model.js';
import Category from './category.model.js';
import Product from './product.model.js';
import StockMovement from './stockMovement.model.js';
import Payment from './payment.model.js';
import InstallmentPlan from './installmentPlan.model.js';
import User from './user.model.js';
import Customer from './customer.model.js';
import Supplier from './supplier.model.js';
import Purchase from './purchase.model.js';
import PurchaseItem from './purchaseItem.model.js';
import Order from './order.model.js';
import OrderItem from './orderItem.model.js';
import ComboItem from './comboItem.model.js';
import PlatformAdmin from './platformAdmin.model.js';
import ClosureRecord from './closureRecord.model.js';
import AuditLog from './auditLog.model.js';
import DiningTable from './diningTable.model.js';
import TableTab from './tableTab.model.js';
import KitchenTicket from './kitchenTicket.model.js';
import TabItem from './tabItem.model.js';
import OrderPayment from './orderPayment.model.js';

// Borrado de registros con historial: las claves de remitos y compras hacia clientes, proveedores,
// productos y formas de pago son RESTRICT. La base rechaza borrar algo que ya se usó en un remito
// o una compra, y los controladores avisan antes con un 409 (ver customer/supplier/product).
// Los movimientos de stock siguen en CASCADE: un producto nunca vendido ni comprado se puede borrar.

Business.hasMany(Category, { foreignKey: 'businessId' });
Category.belongsTo(Business, { foreignKey: 'businessId' });

Category.hasMany(Category, { as: 'subcategories', foreignKey: 'parentId' });
Category.belongsTo(Category, { as: 'parent', foreignKey: 'parentId' });

Business.hasMany(Product, { foreignKey: 'businessId' });
Product.belongsTo(Business, { foreignKey: 'businessId' });

Category.hasMany(Product, { foreignKey: 'categoryId' });
Product.belongsTo(Category, { foreignKey: 'categoryId' });

Product.hasMany(StockMovement, { foreignKey: 'productId' });
StockMovement.belongsTo(Product, { foreignKey: 'productId' });

Business.hasMany(Payment, { foreignKey: 'businessId' });
Payment.belongsTo(Business, { foreignKey: 'businessId' });

Payment.hasMany(InstallmentPlan, { as: 'installmentPlans', foreignKey: 'paymentId' });
InstallmentPlan.belongsTo(Payment, { foreignKey: 'paymentId' });

Business.hasMany(User, { foreignKey: 'businessId' });
User.belongsTo(Business, { foreignKey: 'businessId' });

Business.hasMany(Customer, { foreignKey: 'businessId' });
Customer.belongsTo(Business, { foreignKey: 'businessId' });

Business.hasMany(Supplier, { foreignKey: 'businessId' });
Supplier.belongsTo(Business, { foreignKey: 'businessId' });

Business.hasMany(Purchase, { foreignKey: 'businessId' });
Purchase.belongsTo(Business, { foreignKey: 'businessId' });

Supplier.hasMany(Purchase, { foreignKey: 'supplierId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Purchase.belongsTo(Supplier, { foreignKey: 'supplierId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

Purchase.hasMany(PurchaseItem, { as: 'items', foreignKey: 'purchaseId' });
PurchaseItem.belongsTo(Purchase, { foreignKey: 'purchaseId' });

Product.hasMany(PurchaseItem, { foreignKey: 'productId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
PurchaseItem.belongsTo(Product, { foreignKey: 'productId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

Business.hasMany(Order, { foreignKey: 'businessId' });
Order.belongsTo(Business, { foreignKey: 'businessId' });

Customer.hasMany(Order, { foreignKey: 'customerId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Order.belongsTo(Customer, { foreignKey: 'customerId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

Payment.hasMany(Order, { foreignKey: 'paymentId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
Order.belongsTo(Payment, { foreignKey: 'paymentId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

InstallmentPlan.hasMany(Order, { foreignKey: 'installmentPlanId' });
Order.belongsTo(InstallmentPlan, { foreignKey: 'installmentPlanId' });

Order.hasMany(OrderItem, { as: 'items', foreignKey: 'orderId' });
OrderItem.belongsTo(Order, { foreignKey: 'orderId' });

// Mesas: sin claves foráneas en la base (constraints: false), igual que en migrations/003
TableTab.belongsTo(DiningTable, { as: 'table', foreignKey: 'tableId', constraints: false });
TableTab.hasMany(TabItem, { as: 'items', foreignKey: 'tabId', constraints: false });
TableTab.hasMany(KitchenTicket, { as: 'tickets', foreignKey: 'tabId', constraints: false });
KitchenTicket.belongsTo(TableTab, { as: 'tab', foreignKey: 'tabId', constraints: false });
KitchenTicket.hasMany(TabItem, { as: 'items', foreignKey: 'ticketId', constraints: false });
Order.hasMany(OrderPayment, { as: 'payments', foreignKey: 'orderId', constraints: false });
OrderPayment.belongsTo(Payment, { foreignKey: 'paymentId', constraints: false });

Product.hasMany(OrderItem, { foreignKey: 'productId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });
OrderItem.belongsTo(Product, { foreignKey: 'productId', onDelete: 'RESTRICT', onUpdate: 'CASCADE' });

// Combos: un producto "combo" tiene componentes; un producto puede estar en varios combos
Product.hasMany(ComboItem, { as: 'components', foreignKey: 'comboId', onDelete: 'CASCADE' });
ComboItem.belongsTo(Product, { as: 'combo', foreignKey: 'comboId' });
Product.hasMany(ComboItem, { as: 'usedInCombos', foreignKey: 'productId', onDelete: 'CASCADE' });
ComboItem.belongsTo(Product, { as: 'product', foreignKey: 'productId' });

export {
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
  PlatformAdmin,
  ClosureRecord,
  AuditLog,
  DiningTable,
  TableTab,
  KitchenTicket,
  TabItem,
  OrderPayment,
};
