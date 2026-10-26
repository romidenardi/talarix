import dotenv from 'dotenv';
dotenv.config();

import bcrypt from 'bcryptjs';
import { sequelize, PlatformAdmin } from '../src/models/index.js';

const name = process.env.PLATFORM_ADMIN_NAME || 'Superadmin';
const email = (process.env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase();
const password = process.env.PLATFORM_ADMIN_PASSWORD || '';

if (!email || password.length < 12) {
  console.error('Definí PLATFORM_ADMIN_EMAIL y PLATFORM_ADMIN_PASSWORD (mínimo 12 caracteres).');
  process.exit(1);
}

try {
  await sequelize.authenticate();
  await PlatformAdmin.sync();

  const passwordHash = await bcrypt.hash(password, 12);
  const existing = await PlatformAdmin.findOne({ where: { email } });

  if (existing) {
    await existing.update({ name, passwordHash, active: true });
    console.log('Superadmin actualizado:', email);
  } else {
    await PlatformAdmin.create({ name, email, passwordHash });
    console.log('Superadmin creado:', email);
  }
} catch (error) {
  console.error('Error:', error.message);
  process.exitCode = 1;
} finally {
  await sequelize.close();
}
