// Bloque 8: la prueba gratis vence sola, se renueva hasta una fecha o sin vencimiento
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { startTestServer, createBusiness } from './helpers.js';

let api;
let models;
let stop;
let runTrialExpiry;
let platformToken;

const DAY_MS = 24 * 60 * 60 * 1000;
// Día argentino de una fecha, como AAAA-MM-DD
const arDay = (date) => new Date(date.getTime() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

before(async () => {
  ({ api, models, stop } = await startTestServer());
  ({ runTrialExpiry } = await import('../../src/services/trialExpiry.service.js'));
  const admin = await models.PlatformAdmin.create({
    name: 'Superadmin',
    email: 'super@talarix.test',
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

const platform = (method, path, body) => api(method, `/api/platform${path}`, { token: platformToken, body });
const login = (business) =>
  api('POST', '/api/auth/login', {
    body: { email: business.users.admin.email, password: business.password },
  });
const reload = (business) => models.Business.findByPk(business.business.id);
const setTrial = (business, trialEndsAt) =>
  models.Business.update({ trialEndsAt }, { where: { id: business.business.id } });

describe('Vencimiento de la prueba', () => {
  it('suspende solo a los clientes con la prueba vencida', async () => {
    const expired = await createBusiness(models, 'Vencido');
    const later = await createBusiness(models, 'Vence despues');
    const unlimited = await createBusiness(models, 'Sin vencimiento');
    const demo = await createBusiness(models, 'Demo vieja');
    await setTrial(expired, new Date(Date.now() - 60 * 1000));
    await setTrial(later, new Date(Date.now() + 2 * DAY_MS));
    await setTrial(demo, new Date(Date.now() - DAY_MS));
    await models.Business.update({ type: 'demo' }, { where: { id: demo.business.id } });

    const suspended = await runTrialExpiry();
    assert.deepEqual(suspended, [expired.business.id]);

    const after = await reload(expired);
    assert.equal(after.status, 'suspended');
    assert.equal(after.suspendedReason, 'trial_expired');
    for (const other of [later, unlimited, demo]) assert.equal((await reload(other)).status, 'active');

    // Las sesiones abiertas se cortan y el ingreso explica por qué
    const session = await api('GET', '/api/products', {
      token: expired.users.admin.token,
    });
    assert.equal(session.status, 401);
    const res = await login(expired);
    assert.equal(res.status, 403);
    assert.match(res.body.message, /período de prueba/);

    const logged = await models.AuditLog.findOne({
      where: {
        action: 'business.trial_expired',
        businessId: expired.business.id,
      },
    });
    assert.ok(logged, 'queda en el registro de actividad');

    // Correrla de nuevo no hace nada
    assert.deepEqual(await runTrialExpiry(), []);
  });

  it('con la prueba vencida no se reactiva sin renovar', async () => {
    const business = await createBusiness(models, 'Sin renovar');
    await setTrial(business, new Date(Date.now() - 60 * 1000));
    await runTrialExpiry();

    const res = await platform('PATCH', `/businesses/${business.business.id}/status`, { status: 'active' });
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'TRIAL_EXPIRED');
  });

  it('renovar hasta una fecha lo reactiva; vence al terminar ese día', async () => {
    const business = await createBusiness(models, 'Renovado');
    await setTrial(business, new Date(Date.now() - 60 * 1000));
    await runTrialExpiry();

    const until = arDay(new Date(Date.now() + 10 * DAY_MS));
    const res = await platform('PATCH', `/businesses/${business.business.id}/trial`, { until });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.status, 'active');
    assert.equal(res.body.reactivated, true);

    const after = await reload(business);
    assert.equal(after.suspendedReason, null);
    assert.equal(arDay(after.trialEndsAt), until);
    assert.equal(after.trialEndsAt.toISOString(), new Date(`${until}T23:59:59-03:00`).toISOString());

    assert.equal((await login(business)).status, 200);
    assert.deepEqual(await runTrialExpiry(), [], 'la fecha nueva todavía no venció');
  });

  it('renovar sin vencimiento deja trialEndsAt vacío', async () => {
    const business = await createBusiness(models, 'Indefinido');
    await setTrial(business, new Date(Date.now() + DAY_MS));
    const res = await platform('PATCH', `/businesses/${business.business.id}/trial`, { until: null });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.trialEndsAt, null);
    assert.equal(res.body.reactivated, false);
  });

  it('rechaza fechas pasadas, mal escritas o inexistentes, y la demo', async () => {
    const business = await createBusiness(models, 'Fechas');
    const path = `/businesses/${business.business.id}/trial`;
    const yesterday = arDay(new Date(Date.now() - DAY_MS));
    for (const until of [yesterday, '27/10/2026', '2030-02-30', 'mañana', undefined, 30]) {
      const res = await platform('PATCH', path, { until });
      assert.equal(res.status, 400, `until=${until}: ${JSON.stringify(res.body)}`);
    }
    const farAway = await platform('PATCH', path, {
      until: arDay(new Date(Date.now() + 4 * 366 * DAY_MS)),
    });
    assert.equal(farAway.status, 400);

    const demo = await createBusiness(models, 'Demo fechas');
    await models.Business.update({ type: 'demo' }, { where: { id: demo.business.id } });
    const res = await platform('PATCH', `/businesses/${demo.business.id}/trial`, { until: null });
    assert.equal(res.status, 400);
  });

  it('una suspensión manual no se levanta al renovar la prueba', async () => {
    const business = await createBusiness(models, 'Manual');
    const suspend = await platform('PATCH', `/businesses/${business.business.id}/status`, { status: 'suspended' });
    assert.equal(suspend.status, 200, JSON.stringify(suspend.body));
    assert.equal((await reload(business)).suspendedReason, 'manual');

    const renew = await platform('PATCH', `/businesses/${business.business.id}/trial`, { until: null });
    assert.equal(renew.status, 200);
    assert.equal(renew.body.status, 'suspended');

    const reactivate = await platform('PATCH', `/businesses/${business.business.id}/status`, { status: 'active' });
    assert.equal(reactivate.status, 200, JSON.stringify(reactivate.body));
    assert.equal((await reload(business)).suspendedReason, null);

    const list = await platform('GET', '/businesses');
    const row = list.body.find((b) => b.id === business.business.id);
    assert.equal(row.status, 'active');
    assert.ok('suspendedReason' in row);
  });
});
