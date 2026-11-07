// Botones de baja y de arrepentimiento (públicos) y limpieza del registro de actividad
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { startTestServer, createBusiness } from './helpers.js';

let api;
let models;
let stop;
let platformToken;
let A;

before(async () => {
  ({ api, models, stop } = await startTestServer());
  A = await createBusiness(models, 'Almacen Baja');
  const admin = await models.PlatformAdmin.create({
    name: 'Superadmin',
    email: 'super-baja@talarix.test',
    passwordHash: await bcrypt.hash('clave-super-123', 4),
    active: true,
    totpEnabled: true,
  });
  platformToken = jwt.sign({ adminId: admin.id, scope: 'platform' }, process.env.PLATFORM_JWT_SECRET, {
    expiresIn: '1h',
  });
});

after(async () => {
  await stop?.();
});

// Ojo: la ruta pública admite 5 pedidos por hora desde la misma IP; este archivo usa 4
const request = (body) => api('POST', '/api/public/requests', { body });
const platform = (method, path, body) => api(method, `/api/platform${path}`, { token: platformToken, body });

describe('Botones de baja y de arrepentimiento', () => {
  let baja;

  it('cualquiera pide la baja sin ingresar y recibe un código', async () => {
    const res = await request({
      kind: 'cancellation',
      name: 'Dueña del almacén',
      email: ` ${A.users.admin.email.toUpperCase()} `,
      businessName: 'Almacén',
      reason: 'Cierro el local',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.code, /^BAJ-[A-Z2-9]{8}$/);
    assert.equal(res.body.kind, 'cancellation');

    baja = await models.ServiceRequest.findOne({ where: { code: res.body.code } });
    assert.equal(baja.email, A.users.admin.email, 'el email se guarda normalizado');
    assert.equal(baja.businessId, A.business.id, 'se vincula al comercio de ese email');
    assert.equal(baja.status, 'pending');
  });

  it('el arrepentimiento responde igual aunque el email no sea de ninguna cuenta', async () => {
    const res = await request({ kind: 'withdrawal', name: 'Alguien', email: 'nadie@ningun-lado.test', reason: 'x' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.code, /^ARR-/);
    const saved = await models.ServiceRequest.findOne({ where: { code: res.body.code } });
    assert.equal(saved.businessId, null);
    assert.equal(saved.reason, null, 'el arrepentimiento no pide motivo');
  });

  it('valida el email y descarta a los robots', async () => {
    assert.equal((await request({ kind: 'cancellation', name: 'X', email: 'sin-arroba' })).status, 400);
    const bot = await request({ kind: 'cancellation', name: 'X', email: 'bot@spam.test', website: 'http://spam' });
    assert.equal(bot.status, 400);
    assert.equal(await models.ServiceRequest.count({ where: { email: 'bot@spam.test' } }), 0);
  });

  it('el superadmin las ve (pendientes primero) y las marca resueltas', async () => {
    assert.equal((await api('GET', '/api/platform/requests')).status, 401, 'sin sesión de plataforma, no');
    assert.equal((await api('GET', '/api/platform/requests', { token: A.users.admin.token })).status, 401);

    const list = await platform('GET', '/requests');
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.equal(list.body.length, 2);
    const item = list.body.find((r) => r.id === baja.id);
    assert.equal(item.business.name, 'Almacen Baja');

    const done = await platform('PATCH', `/requests/${baja.id}`, { status: 'done', note: 'Baja iniciada' });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.status, 'done');
    assert.ok(done.body.resolvedAt);

    const pending = await platform('GET', '/requests?status=pending');
    assert.deepEqual(
      pending.body.map((r) => r.kind),
      ['withdrawal'],
    );
    assert.equal((await platform('PATCH', `/requests/${baja.id}`, { status: 'otro' })).status, 400);
  });
});

describe('Limpieza del registro de actividad', () => {
  it('borra los registros de más de 12 meses y deja los demás', async () => {
    const { runAuditCleanup } = await import('../../src/services/auditCleanup.service.js');
    const old = await models.AuditLog.create({ actorType: 'system', action: 'test.viejo' });
    const recent = await models.AuditLog.create({ actorType: 'system', action: 'test.reciente' });
    const thirteenMonthsAgo = new Date();
    thirteenMonthsAgo.setMonth(thirteenMonthsAgo.getMonth() - 13);
    await models.sequelize.query('UPDATE audit_logs SET createdAt = ? WHERE id = ?', {
      replacements: [thirteenMonthsAgo, old.id],
    });

    const removed = await runAuditCleanup();
    assert.ok(removed >= 1);
    assert.equal(await models.AuditLog.findByPk(old.id), null);
    assert.ok(await models.AuditLog.findByPk(recent.id));
  });
});
