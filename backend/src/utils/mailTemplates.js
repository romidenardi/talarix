const BRAND = 'Talarix';

const ROLE_LABELS = {
  admin: 'Administrador',
  editor: 'Editor',
  operador: 'Operador',
};

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const ttlText = (ms) => {
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours >= 24) {
    const days = Math.round(hours / 24);
    return `${days} ${days === 1 ? 'día' : 'días'}`;
  }
  if (hours >= 1) return `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  return `${Math.max(1, Math.round(ms / 60000))} minutos`;
};

const layout = ({ preheader, heading, paragraphs, buttonLabel, url, footer }) => `<!doctype html>
<html lang="es">
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937;">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0;">${esc(preheader)}</span>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f4f6;padding:24px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border-radius:10px;padding:32px 28px;">
          <tr>
            <td style="font-size:20px;font-weight:bold;color:#1f2937;padding-bottom:16px;">${BRAND}</td>
          </tr>
          <tr>
            <td style="font-size:18px;font-weight:bold;padding-bottom:12px;">${esc(heading)}</td>
          </tr>
          <tr>
            <td style="font-size:15px;line-height:1.55;">
              ${paragraphs.map((p) => `<p style="margin:0 0 12px;">${p}</p>`).join('')}
            </td>
          </tr>
          <tr>
            <td style="padding:12px 0 20px;">
              <a href="${esc(url)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:12px 22px;border-radius:8px;">${esc(buttonLabel)}</a>
            </td>
          </tr>
          <tr>
            <td style="font-size:12px;line-height:1.5;color:#6b7280;">
              Si el botón no funciona, copiá y pegá este link en tu navegador:<br>
              <span style="word-break:break-all;">${esc(url)}</span>
              <p style="margin:14px 0 0;">${footer}</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

export const inviteEmail = ({ name, businessName, url, expiresInMs }) => {
  const validity = ttlText(expiresInMs);
  return {
    subject: `Te invitaron a ${BRAND}: creá tu contraseña`,
    html: layout({
      preheader: `Activá tu cuenta de ${businessName}`,
      heading: `Hola ${name}, te invitaron a ${BRAND}`,
      paragraphs: [
        `Te crearon una cuenta para <strong>${esc(businessName)}</strong>.`,
        'Entrá con el botón de abajo para elegir tu contraseña y empezar a usar el sistema.',
      ],
      buttonLabel: 'Crear mi contraseña',
      url,
      footer: `Este link es personal y vale ${validity}. Si no esperabas esta invitación, ignorá este mail.`,
    }),
    text: [
      `Hola, ${name},`,
      '',
      `Te crearon una cuenta en ${BRAND} para ${businessName}.`,
      'Elegí tu contraseña desde este link:',
      url,
      '',
      `El link es personal y vale ${validity}. Si no esperabas esta invitación, ignorá este mail.`,
    ].join('\n'),
  };
};

export const userCreatedEmail = ({ name, businessName, role, creatorName, loginUrl }) => {
  const roleLabel = ROLE_LABELS[role] || role;
  return {
    subject: `Tu usuario en ${BRAND} ya está creado`,
    html: layout({
      preheader: `Ya podés ingresar a ${businessName}`,
      heading: `Hola, ${name}, ya tenés usuario`,
      paragraphs: [
        `${creatorName ? `<strong>${esc(creatorName)}</strong> te` : 'Te'} creó un usuario en <strong>${esc(businessName)}</strong> con el rol <strong>${esc(roleLabel)}</strong>.`,
        'Pedile la contraseña inicial a quien te dio de alta, o usá "¿Olvidaste tu contraseña?" en la pantalla de ingreso para elegir una nueva.',
      ],
      buttonLabel: 'Ir a iniciar sesión',
      url: loginUrl,
      footer: 'Por seguridad, este mail no incluye tu contraseña.',
    }),
    text: [
      `Hola, ${name},`,
      '',
      `Te crearon un usuario en ${BRAND} para ${businessName} con el rol ${roleLabel}.`,
      'Pedile la contraseña inicial a quien te dio de alta, o usá "¿Olvidaste tu contraseña?" en la pantalla de ingreso.',
      '',
      `Ingresá desde: ${loginUrl}`,
      '',
      'Por seguridad, este mail no incluye tu contraseña.',
    ].join('\n'),
  };
};

export const resetEmail = ({ name, url, expiresInMs }) => {
  const validity = ttlText(expiresInMs);
  return {
    subject: `Restablecé tu contraseña de ${BRAND}`,
    html: layout({
      preheader: 'Elegí una contraseña nueva',
      heading: `Hola, ${name}`,
      paragraphs: [
        'Recibimos un pedido para restablecer tu contraseña.',
        'Tocá el botón para elegir una nueva. Tu contraseña actual sigue siendo válida hasta que completes el cambio.',
      ],
      buttonLabel: 'Elegir nueva contraseña',
      url,
      footer: `El link vale ${validity} y se puede usar una sola vez. Si no lo pediste vos, ignorá este mail: tu cuenta sigue segura.`,
    }),
    text: [
      `Hola, ${name},`,
      '',
      'Recibimos un pedido para restablecer tu contraseña de Talarix.',
      'Elegí una nueva desde este link:',
      url,
      '',
      `El link vale ${validity} y se usa una sola vez. Si no lo pediste vos, ignorá este mail.`,
    ].join('\n'),
  };
};
