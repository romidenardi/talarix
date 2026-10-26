// Siempre queda al menos un administrador, aunque dos se quiten el rol al mismo tiempo
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import bcrypt from 'bcryptjs';
import { startTestServer, createBusiness, tokenFor } from './helpers.js';

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
