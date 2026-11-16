// Diseño común de los mails del sistema, con la identidad de Talarix (los mismos colores y la misma
// tipografía que el sitio). Está armado con tablas y estilos en línea, que es lo que respetan Gmail,
// Outlook y los celulares. Cada mail lleva además su versión en texto plano.
//
// El logo se carga desde el sitio (EMAIL_LOGO_URL, por defecto el de talarix.com.ar). Si el programa
// de correo no muestra imágenes, se ve el nombre "Talarix" en su lugar.

const NAVY = '#13395c';
const ACCENT = '#2e7eb0';
const BG = '#f4f7fa';
const TEXT = '#1c2733';
const MUTED = '#64748b';
const BORDER = '#dce3ea';
const FONT = "'Plus Jakarta Sans', Arial, Helvetica, sans-serif";

export const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const supportEmail = () => process.env.SUPPORT_EMAIL || 'hola@talarix.com.ar';
const logoUrl = () => process.env.EMAIL_LOGO_URL || 'https://www.talarix.com.ar/img/logo.png';
const siteUrl = () => (process.env.SITE_URL || 'https://www.talarix.com.ar').replace(/\/$/, '');

// Un recuadro destacado (un código, una fecha): { label, value }
const highlight = ({ label, value }) => `
          <tr>
            <td style="padding:4px 0 20px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BG};border-radius:12px;">
                <tr>
                  <td style="padding:16px 20px;font-family:${FONT};">
                    <div style="font-size:12px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:${MUTED};">${esc(label)}</div>
                    <div style="font-size:22px;font-weight:800;color:${NAVY};padding-top:4px;">${esc(value)}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;

// Una tabla de datos (para los avisos internos): [[etiqueta, valor], ...]
const details = (rows) => `
          <tr>
            <td style="padding:4px 0 20px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ${BORDER};border-radius:12px;border-collapse:separate;">
                ${rows
                  .map(
                    ([label, value], i) => `<tr>
                  <td style="padding:10px 16px;font-family:${FONT};font-size:13px;color:${MUTED};width:38%;vertical-align:top;${i ? `border-top:1px solid ${BORDER};` : ''}">${esc(label)}</td>
                  <td style="padding:10px 16px;font-family:${FONT};font-size:14px;color:${TEXT};vertical-align:top;word-break:break-word;${i ? `border-top:1px solid ${BORDER};` : ''}">${esc(value)}</td>
                </tr>`,
                  )
                  .join('')}
              </table>
            </td>
          </tr>`;

const button = ({ label, url }) => `
          <tr>
            <td style="padding:8px 0 24px;">
              <table role="presentation" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="background:${NAVY};border-radius:10px;">
                    <a href="${esc(url)}" style="display:inline-block;padding:14px 26px;font-family:${FONT};font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:10px;">${esc(label)}</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>`;

// paragraphs: HTML ya escapado (cada uno es un <p>). button: { label, url }. linkFallback: muestra el
// link escrito debajo del botón. note: texto chico al final (HTML ya escapado).
export const brandedEmail = ({
  preheader = '',
  heading,
  paragraphs = [],
  highlight: box,
  details: rows,
  button: cta,
  linkFallback = false,
  note,
}) => `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${esc(heading)}</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;700;800&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${BG};">
  <span style="display:none;max-height:0;max-width:0;overflow:hidden;opacity:0;color:${BG};">${esc(preheader)}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BG};">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;">
          <tr>
            <td style="background:#ffffff;border-radius:16px;padding:28px 32px 8px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="padding-bottom:20px;border-bottom:1px solid ${BORDER};">
                    <a href="${esc(siteUrl())}" style="text-decoration:none;">
                      <img src="${esc(logoUrl())}" width="132" height="44" alt="Talarix" style="display:block;border:0;height:44px;width:132px;font-family:${FONT};font-size:24px;font-weight:800;color:${NAVY};">
                    </a>
                  </td>
                </tr>
              </table>
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="font-family:${FONT};font-size:22px;line-height:1.3;font-weight:800;color:${NAVY};padding:24px 0 16px;">${esc(heading)}</td>
                </tr>
                <tr>
                  <td style="font-family:${FONT};font-size:15px;line-height:1.6;color:${TEXT};padding-bottom:8px;">
                    ${paragraphs.map((p) => `<p style="margin:0 0 14px;">${p}</p>`).join('')}
                  </td>
                </tr>${box ? highlight(box) : ''}${rows?.length ? details(rows) : ''}${cta ? button(cta) : ''}${
                  cta && linkFallback
                    ? `
                <tr>
                  <td style="font-family:${FONT};font-size:12px;line-height:1.5;color:${MUTED};padding-bottom:20px;">
                    Si el botón no funciona, copiá y pegá este link en tu navegador:<br>
                    <a href="${esc(cta.url)}" style="color:${ACCENT};word-break:break-all;">${esc(cta.url)}</a>
                  </td>
                </tr>`
                    : ''
                }${
                  note
                    ? `
                <tr>
                  <td style="font-family:${FONT};font-size:13px;line-height:1.55;color:${MUTED};border-top:1px solid ${BORDER};padding:16px 0 24px;">${note}</td>
                </tr>`
                    : ''
                }
              </table>
            </td>
          </tr>
          <tr>
            <td align="center" style="padding:20px 12px 0;font-family:${FONT};font-size:12px;line-height:1.6;color:${MUTED};">
              Talarix · Gestión para comercios y pymes argentinas<br>
              <a href="${esc(siteUrl())}" style="color:${ACCENT};text-decoration:none;">talarix.com.ar</a> ·
              <a href="mailto:${esc(supportEmail())}" style="color:${ACCENT};text-decoration:none;">${esc(supportEmail())}</a><br>
              Este es un mail automático del sistema.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
