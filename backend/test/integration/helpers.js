// Ayudas para las pruebas de integración: levantan la API de verdad contra una base MySQL de
// pruebas, que se BORRA Y SE CREA DE NUEVO en cada corrida.
//
// Por seguridad, la base tiene que llamarse algo terminado en "_test" (por defecto talarix_test):
// nunca puede apuntar a la base local de trabajo, a staging ni a producción.
// Usa DB_HOST, DB_PORT, DB_USER y DB_PASSWORD del entorno o del .env, y TEST_DB_NAME si está.
import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';

dotenv.config();

process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'talarix_test';
process.env.JWT_SECRET ||= 'secreto-solo-para-pruebas';
process.env.PLATFORM_JWT_SECRET ||= 'otro-secreto-solo-para-pruebas';
process.env.APP_URL ||= 'http://localhost:5173';
delete process.env.SENTRY_DSN;
delete process.env.MAIL_HOST;

if (!/_test$/.test(process.env.DB_NAME)) {
  throw new Error(`La base de pruebas tiene que terminar en "_test" (es "${process.env.DB_NAME}")`);
}

export const newRequestId = () => randomUUID();

// Crea la base de cero, levanta la API en un puerto libre y devuelve cómo llamarla
export const startTestServer = async () => {
  const admin = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });
  await admin.query(`DROP DATABASE IF EXISTS \`${process.env.DB_NAME}\``);
  await admin.query(`CREATE DATABASE \`${process.env.DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.end();

  // Recién ahora: los módulos leen la configuración de la base al importarse
  const { default: app } = await import('../../src/app.js');
  const models = await import('../../src/models/index.js');
  await models.sequelize.sync();

  const server = await new Promise((resolve) => {
    const s = app.listen(0, () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  // api('POST', '/api/orders', { token, body }) → { status, body }
  const api = async (method, path, { token, body } = {}) => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: response.status, body: data };
  };

  // upload('/api/imports/products', { token, filename: 'p.csv', content: 'texto o Buffer' })
  const upload = async (path, { token, filename, content }) => {
    const form = new FormData();
    form.append('file', new Blob([content]), filename);
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: form,
    });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    return { status: response.status, body: data };
  };

  const stop = async () => {
    await new Promise((resolve) => server.close(resolve));
    await models.sequelize.close();
  };

  return { api, upload, models, stop };
};

const tokenFor = (user) =>
  jwt.sign(
    { id: user.id, businessId: user.businessId, role: user.role, tv: user.tokenVersion ?? 0 },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );

// Un comercio completo para probar: usuarios de cada rol (con su token), un cliente, una forma
// de pago y productos con stock. La contraseña de todos es la que se devuelve en `password`.
export const createBusiness = async (models, name) => {
  const { Business, User, Customer, Payment, Product } = models;
  const password = 'clave-de-prueba-123';
  const passwordHash = await bcrypt.hash(password, 4);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');

  const business = await Business.create({ name });
  const users = {};
  for (const role of ['admin', 'editor', 'operador']) {
    const user = await User.create({
      businessId: business.id,
      name: `${role} ${name}`,
      email: `${role}@${slug}.test`,
      role,
      passwordHash,
    });
    users[role] = { ...user.toJSON(), token: tokenFor(user) };
  }

  const customer = await Customer.create({
    businessId: business.id, firstName: 'Cliente', lastName: name, fiscalCondition: 'Consumidor Final',
  });
  const payment = await Payment.create({ businessId: business.id, name: 'Efectivo' });
  const yerba = await Product.create({
    businessId: business.id, internalCode: 'YER', name: 'Yerba 1 kg', unitType: 'unit',
    price: 1000, promoPrice: 900, cost: 600, vatRate: 21, stock: 1000,
  });
  const queso = await Product.create({
    businessId: business.id, internalCode: 'QUE', name: 'Queso por kg', unitType: 'weight',
    price: 30000, cost: 18000, vatRate: 21, stock: 5,
  });

  return { business, users, password, customer, payment, products: { yerba, queso } };
};

export const stockOf = async (models, product) => Number((await models.Product.findByPk(product.id)).stock);
