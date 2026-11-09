const TIMEZONE = 'America/Argentina/Buenos_Aires';

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const formatDate = (value) =>
  new Date(value).toLocaleDateString('es-AR', {
    timeZone: TIMEZONE,
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

const supportEmail = () => process.env.SUPPORT_EMAIL || 'hola@talarix.com.ar';

export const closureStartedEmail = ({ name, businessName, deleteAt }) => {
  const date = formatDate(deleteAt);
  const appUrl = (process.env.APP_URL || '').replace(/\/$/, '');

  const subject = `Baja de tu cuenta de Talarix: ${businessName}`;

  const text =
    `Hola, ${name}\n\n` +
    `Registramos la baja de la cuenta de "${businessName}".\n\n` +
    `Desde hoy solo podés ingresar con tu usuario de administrador para descargar tus datos en un archivo Excel. ` +
    `Tenés tiempo hasta el ${date}: ese día los datos se eliminan definitivamente ` +
    `(las copias de seguridad pueden conservarlos hasta 90 días más).\n\n` +
    (appUrl ? `Ingresá en ${appUrl}\n\n.` : '') +
    `Si la baja fue un error o cambiaste de opinión, escribinos a ${supportEmail()} y la cancelamos.\n\n` +
    `Gracias por haber probado Talarix.`;

  const html =
    `<p>Hola, ${escapeHtml(name)}</p>` +
    `<p>Registramos la baja de la cuenta de <strong>${escapeHtml(businessName)}</strong>.</p>` +
    `<p>Desde hoy solo podés ingresar con tu usuario de administrador para <strong>descargar tus datos en un archivo Excel</strong>. ` +
    `Tenés tiempo hasta el <strong>${escapeHtml(date)}</strong>: ese día los datos se eliminan definitivamente ` +
    `(las copias de seguridad pueden conservarlos hasta 90 días más).</p>` +
    (appUrl ? `<p>Ingresá en <a href="${escapeHtml(appUrl)}">${escapeHtml(appUrl)}</a></p>.` : '') +
    `<p>Si la baja fue un error o cambiaste de opinión, escribinos a ${escapeHtml(supportEmail())} y la cancelamos.</p>` +
    `<p>Gracias por haber probado Talarix.</p>`;

  return { subject, text, html };
};
