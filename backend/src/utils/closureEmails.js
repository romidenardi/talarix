// Aviso a los administradores cuando se registra la baja de un comercio. Usa el diseño común de
// utils/emailLayout.js y va también en texto plano.
import { brandedEmail, esc, supportEmail } from './emailLayout.js';
import { appUrl } from './mailer.js';

const TIMEZONE = 'America/Argentina/Buenos_Aires';

const formatDate = (value) =>
  new Date(value).toLocaleDateString('es-AR', {
    timeZone: TIMEZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

export const closureStartedEmail = ({ name, businessName, deleteAt }) => {
  const date = formatDate(deleteAt);
  const loginUrl = appUrl();
  const hasUrl = loginUrl.startsWith('http');

  const subject = `Baja de tu cuenta de Talarix: ${businessName}`;

  const text =
    `Hola, ${name}\n\n` +
    `Registramos la baja de la cuenta de "${businessName}".\n\n` +
    `Desde hoy solo podés ingresar con tu usuario de administrador para descargar tus datos en un archivo Excel. ` +
    `Tenés tiempo hasta el ${date}: ese día los datos se eliminan definitivamente ` +
    `(las copias de seguridad pueden conservarlos hasta 90 días más).\n\n` +
    (hasUrl ? `Ingresá en ${loginUrl}\n\n` : '') +
    `Si la baja fue un error o cambiaste de opinión, escribinos a ${supportEmail()} y la cancelamos.\n\n` +
    `Gracias por haber probado Talarix.`;

  const html = brandedEmail({
    preheader: `Podés descargar tus datos hasta el ${date}`,
    heading: 'Registramos la baja de tu cuenta',
    paragraphs: [
      `Hola, ${esc(name)}:`,
      `Registramos la baja de la cuenta de <strong>${esc(businessName)}</strong>.`,
      'Desde hoy solo podés ingresar con tu usuario de administrador para <strong>descargar tus datos en un archivo Excel</strong>.',
    ],
    highlight: { label: 'Podés descargar tus datos hasta el', value: date },
    ...(hasUrl ? { button: { label: 'Ingresar y descargar mis datos', url: loginUrl } } : {}),
    note:
      'Ese día los datos se eliminan definitivamente (las copias de seguridad pueden conservarlos hasta 90 días más).<br><br>' +
      `Si la baja fue un error o cambiaste de opinión, escribinos a <a href="mailto:${esc(supportEmail())}" style="color:#2e7eb0;">${esc(supportEmail())}</a> y la cancelamos.<br><br>` +
      'Gracias por haber probado Talarix.',
  });

  return { subject, text, html };
};
