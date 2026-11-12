// Formulario «Agendá una demo» del sitio web: usa la misma ruta pública que los botones de baja
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startTestServer } from './helpers.js';
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
