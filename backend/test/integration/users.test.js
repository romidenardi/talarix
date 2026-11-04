// Siempre queda al menos un administrador, aunque dos se quiten el rol al mismo tiempo
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { startTestServer, createBusiness, tokenFor } from './helpers.js';
import { hashToken } from '../../src/utils/inviteToken.js';
import { LEGAL_VERSION } from '../../src/utils/legal.js';

let api;
let models;
let stop;
let A;

before(async () => {
  ({ api, models, stop } = await startTestServer());
  A = await createBusiness(models, 'Usuarios A');
});

after(async () => {
  await stop?.();
});

const secondAdmin = async (label) => {
  const user = await models.User.create({
    businessId: A.business.id,
    name: `Admin ${label}`,
    email: `admin-${label}@usuarios-a.test`,
    role: 'admin',
    passwordHash: await bcrypt.hash('clave-de-prueba-123', 4),
  });
  return { ...user.toJSON(), token: tokenFor(user) };
};
const activeAdmins = () => models.User.count({ where: { businessId: A.business.id, role: 'admin', active: true } });

describe('Administradores', () => {
  it('dos administradores se quitan el rol entre sí al mismo tiempo: siempre queda uno', async () => {
    const b = await secondAdmin('b');
    const first = A.users.admin;
    const [r1, r2] = await Promise.all([
      api('PUT', `/api/users/${b.id}`, { token: first.token, body: { role: 'editor' } }),
      api('PUT', `/api/users/${first.id}`, { token: b.token, body: { role: 'editor' } }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    assert.equal(statuses[0], 200, `alguno tiene que poder: ${JSON.stringify([r1.body, r2.body])}`);
    assert.ok(statuses[1] >= 400, 'el otro tiene que ser rechazado');
    assert.equal(await activeAdmins(), 1);
  });

  it('no se puede desactivar ni borrar al último administrador activo', async () => {
    const remaining = await models.User.findOne({ where: { businessId: A.business.id, role: 'admin', active: true } });
    const other = await secondAdmin('c');
    // "other" intenta desactivar al que queda: puede, porque quedaría él
    const ok = await api('PUT', `/api/users/${remaining.id}`, { token: other.token, body: { active: false } });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    // y ahora no puede borrarse ni desactivarse a sí mismo, ni quedar sin otro admin
    const self = await api('DELETE', `/api/users/${other.id}`, { token: other.token });
    assert.equal(self.status, 400);
    assert.equal(await activeAdmins(), 1);
  });

  it('un admin que acaba de perder el rol ya no puede cambiar a otros', async () => {
    const d = await secondAdmin('d');
    const e = await secondAdmin('e');
    await models.User.update({ role: 'editor' }, { where: { id: d.id } });
    // d todavía tiene un token de admin, pero el servidor revisa su rol actual
    const res = await api('PUT', `/api/users/${e.id}`, { token: d.token, body: { role: 'editor' } });
    assert.ok(res.status === 403, `status ${res.status}`);
    assert.equal((await models.User.findByPk(e.id)).role, 'admin');
  });
});

describe('Edición de usuarios', () => {
  it('valida el email, el nombre y el estado, igual que al crear', async () => {
    const target = await models.User.create({
      businessId: A.business.id,
      name: 'Operador Uno',
      email: 'operador-uno@usuarios-a.test',
      role: 'operador',
      passwordHash: await bcrypt.hash('clave-de-prueba-123', 4),
    });
    const admin = await models.User.findOne({ where: { businessId: A.business.id, role: 'admin', active: true } });
    const put = (body) => api('PUT', `/api/users/${target.id}`, { token: tokenFor(admin), body });

    assert.equal((await put({ email: 'sin-arroba' })).status, 400);
    assert.equal((await put({ name: '   ' })).status, 400);
    assert.equal((await put({ active: 'no' })).status, 400);
    assert.equal((await put({ role: 'jefe' })).status, 400);
    const fresh = await models.User.findByPk(target.id);
    assert.equal(fresh.email, 'operador-uno@usuarios-a.test');
    assert.equal(fresh.name, 'Operador Uno');

    const ok = await put({ name: '  Operador Dos ', email: ' Operador-Dos@Usuarios-A.test ' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.name, 'Operador Dos');
    assert.equal(ok.body.email, 'operador-dos@usuarios-a.test');
  });
});

describe('Links de cuenta', () => {
  it('el link para restablecer no sirve en "activar": la cuenta ya tiene contraseña', async () => {
    const user = await models.User.create({
      businessId: A.business.id,
      name: 'Editora',
      email: 'editora@usuarios-a.test',
      role: 'editor',
      passwordHash: await bcrypt.hash('clave-de-prueba-123', 4),
      inviteTokenHash: hashToken('token-de-restablecer'),
      inviteExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    const res = await api('POST', '/api/auth/activate', {
      body: {
        token: 'token-de-restablecer',
        password: 'caballo-verde-azul-42',
        acceptTerms: true,
        legalVersion: LEGAL_VERSION,
      },
    });
    assert.equal(res.status, 400);
    assert.match(res.body.message, /ya está activada/);
    const fresh = await models.User.findByPk(user.id);
    assert.equal(fresh.tokenVersion, user.tokenVersion, 'no cambió la contraseña');
    assert.ok(await bcrypt.compare('clave-de-prueba-123', fresh.passwordHash));
  });
});
