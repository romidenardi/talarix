// Mails del sistema: todos salen con el diseño de Talarix, con su versión en texto plano, y sin
// dejar pasar HTML en los datos que escribe la gente
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { inviteEmail, userCreatedEmail, resetEmail } from '../../src/utils/mailTemplates.js';
import { requestReceivedEmail, requestNoticeEmail } from '../../src/utils/serviceRequestEmails.js';
import { closureStartedEmail } from '../../src/utils/closureEmails.js';

const NAME = 'Juan <b>Pérez</b>';
const ALL = {
  invitación: inviteEmail({
    name: NAME,
    businessName: 'Despensa & Cía',
    url: 'https://app.test/activar?token=1',
    expiresInMs: 72 * 3600e3,
  }),
  'usuario creado': userCreatedEmail({
    name: NAME,
    businessName: 'Despensa',
    role: 'mozo',
    creatorName: 'Ana',
    loginUrl: 'https://app.test/login',
  }),
  restablecer: resetEmail({ name: NAME, url: 'https://app.test/restablecer?token=1', expiresInMs: 3600e3 }),
  demo: requestReceivedEmail({ kind: 'demo', code: 'DEM-AAAAAAAA', name: NAME }),
  baja: requestReceivedEmail({ kind: 'cancellation', code: 'BAJ-AAAAAAAA', name: NAME }),
  arrepentimiento: requestReceivedEmail({ kind: 'withdrawal', code: 'ARR-AAAAAAAA', name: NAME }),
  'aviso a soporte': requestNoticeEmail({
    kind: 'demo',
    code: 'DEM-AAAAAAAA',
    name: NAME,
    email: 'j@x.test',
    reason: '<script>x</script>',
  }),
  'baja del comercio': closureStartedEmail({
    name: NAME,
    businessName: 'Despensa',
    deleteAt: new Date('2026-12-31T12:00:00Z'),
  }),
};

describe('Mails del sistema', () => {
  for (const [label, mail] of Object.entries(ALL)) {
    it(`${label}: diseño de Talarix, texto plano y datos escapados`, () => {
      assert.ok(mail.subject);
      assert.match(mail.html, /^<!doctype html>/);
      assert.match(mail.html, /#13395c/, 'colores de la marca');
      assert.match(mail.html, /alt="Talarix"/, 'logo con texto alternativo');
      assert.match(mail.html, /Este es un mail automático del sistema/);
      assert.doesNotMatch(mail.html, /<b>Pérez<\/b>|<script>/, 'el HTML de los datos no pasa');
      assert.ok(mail.text && !/<(p|strong|br|a|table|div)\b/i.test(mail.text), 'texto plano sin etiquetas');
    });
  }

  it('los códigos y las fechas van destacados', () => {
    assert.match(ALL.baja.html, /BAJ-AAAAAAAA/);
    assert.match(ALL['baja del comercio'].html, /31 de diciembre de 2026/);
  });

  it('el texto plano de la baja del comercio no tiene puntos sueltos', () => {
    assert.doesNotMatch(ALL['baja del comercio'].text, /\n\.\s/);
  });
});
