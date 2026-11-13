// Formulario «Agendá una demo» del sitio web: usa la misma ruta pública que los botones de baja
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer, createBusiness, tokenFor } from './helpers.js';
import { requestReceivedEmail, requestNoticeEmail } from '../../src/utils/serviceRequestEmails.js';

let api;
let models;
let stop;

before(async () => {
  ({ api, models, stop } = await startTestServer());
});

after(async () => {
  await stop?.();
});

const request = (body) => api('POST', '/api/public/requests', { body });

describe('Pedido de demo del sitio web', () => {
  it('se registra con código DEM y guarda empresa y comentarios', async () => {
    const res = await request({
      kind: 'demo',
      name: 'Juan Pérez',
      email: 'Juan@LosArces.test',
      businessName: 'Despensa Los Arces',
      reason: 'Tengo dos sucursales',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.match(res.body.code, /^DEM-[A-Z2-9]{8}$/);

    const saved = await models.ServiceRequest.findOne({ where: { code: res.body.code } });
    assert.equal(saved.kind, 'demo');
    assert.equal(saved.email, 'juan@losarces.test');
    assert.equal(saved.businessName, 'Despensa Los Arces');
    assert.equal(saved.reason, 'Tengo dos sucursales');
    assert.equal(saved.status, 'pending');
  });

  it('valida nombre y email, y descarta a los robots', async () => {
    assert.equal((await request({ kind: 'demo', name: '', email: 'a@b.test' })).status, 400);
    assert.equal((await request({ kind: 'demo', name: 'X', email: 'sin-arroba' })).status, 400);
    const bot = await request({ kind: 'demo', name: 'X', email: 'bot@spam.test', website: 'http://spam' });
    assert.equal(bot.status, 400);
  });

  it('los mails hablan de la demo, no de una baja', () => {
    const received = requestReceivedEmail({ kind: 'demo', code: 'DEM-AAAAAAAA', name: 'Juan' });
    assert.match(received.subject, /pedido de demo/);
    assert.doesNotMatch(received.text, /baja/i);
    const notice = requestNoticeEmail({
      kind: 'demo',
      code: 'DEM-AAAAAAAA',
      name: 'Juan',
      email: 'juan@x.test',
      businessName: 'Despensa',
      reason: 'Hola',
    });
    assert.match(notice.subject, /Pedido de demo DEM-AAAAAAAA: Despensa/);
    assert.match(notice.text, /Comentarios: Hola/);
  });
});

describe('Plazos y datos visibles', () => {
  it('los pedidos de demo se borran a los 6 meses; los de baja y arrepentimiento se conservan', async () => {
    const old = new Date();
    old.setMonth(old.getMonth() - 7);
    const base = { name: 'Viejo', email: 'viejo@x.test', status: 'pending' };
    const demo = await models.ServiceRequest.create({ ...base, kind: 'demo', code: 'DEM-OLD00001' });
    const baja = await models.ServiceRequest.create({ ...base, kind: 'cancellation', code: 'BAJ-OLD00001' });
    const recent = await models.ServiceRequest.create({ ...base, kind: 'demo', code: 'DEM-NEW00001' });
    await models.ServiceRequest.update({ createdAt: old }, { where: { id: [demo.id, baja.id] }, silent: true });

    const { runDemoRequestCleanup } = await import('../../src/services/auditCleanup.service.js');
    assert.equal(await runDemoRequestCleanup(), 1);
    assert.equal(await models.ServiceRequest.findByPk(demo.id), null);
    assert.ok(await models.ServiceRequest.findByPk(baja.id), 'la constancia de baja queda');
    assert.ok(await models.ServiceRequest.findByPk(recent.id), 'el pedido reciente queda');
  });

  it('cada usuario del comercio ve el vencimiento de la prueba gratis, también el mozo', async () => {
    const B = await createBusiness(models, 'Con prueba');
    const until = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    await models.Business.update({ trialEndsAt: until }, { where: { id: B.business.id } });

    const admin = await api('GET', '/api/auth/session', { token: B.users.admin.token });
    assert.equal(admin.status, 200, JSON.stringify(admin.body));
    assert.equal(new Date(admin.body.trialEndsAt).getTime(), until.getTime());

    const mozo = await models.User.create({
      businessId: B.business.id,
      name: 'Mozo',
      email: 'mozo-prueba@x.test',
      role: 'mozo',
      passwordHash: B.users.admin.passwordHash,
    });
    assert.equal((await api('GET', '/api/auth/session', { token: tokenFor(mozo) })).status, 200);

    await models.Business.update({ trialEndsAt: null }, { where: { id: B.business.id } });
    const unlimited = await api('GET', '/api/auth/session', { token: B.users.admin.token });
    assert.equal(unlimited.body.trialEndsAt, null);
  });
});
