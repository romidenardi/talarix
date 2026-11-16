// Mails de acceso: invitación, usuario creado y restablecer la contraseña. Usan el diseño común de
// utils/emailLayout.js y van también en texto plano.
import { brandedEmail, esc } from './emailLayout.js';

const BRAND = 'Talarix';

const ROLE_LABELS = {
  admin: 'Administrador',
  editor: 'Editor',
  operador: 'Operador',
  mozo: 'Mozo',
};

const ttlText = (ms) => {
  const hours = Math.round(ms / (60 * 60 * 1000));
  if (hours >= 24) {
    const days = Math.round(hours / 24);
    return `${days} ${days === 1 ? 'día' : 'días'}`;
  }
  if (hours >= 1) return `${hours} ${hours === 1 ? 'hora' : 'horas'}`;
  return `${Math.max(1, Math.round(ms / 60000))} minutos`;
};

export const inviteEmail = ({ name, businessName, url, expiresInMs }) => {
  const validity = ttlText(expiresInMs);
  return {
    subject: `Te invitaron a ${BRAND}: creá tu contraseña`,
    html: brandedEmail({
      preheader: `Activá tu cuenta de ${businessName}`,
      heading: `Te invitaron a ${BRAND}`,
      paragraphs: [
        `Hola, ${esc(name)}:`,
        `Te crearon una cuenta para <strong>${esc(businessName)}</strong>.`,
        'Entrá con el botón de abajo para elegir tu contraseña y empezar a usar el sistema.',
      ],
      button: { label: 'Crear mi contraseña', url },
      linkFallback: true,
      note: `Este link es personal y vale ${validity}. Si no esperabas esta invitación, ignorá este mail.`,
    }),
    text: [
      `Hola, ${name}:`,
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
    html: brandedEmail({
      preheader: `Ya podés ingresar a ${businessName}`,
      heading: `Ya tenés usuario en ${BRAND}`,
      paragraphs: [
        `Hola, ${esc(name)}:`,
        `${creatorName ? `<strong>${esc(creatorName)}</strong> te` : 'Te'} creó un usuario en <strong>${esc(businessName)}</strong> con el rol <strong>${esc(roleLabel)}</strong>.`,
        'Pedile la contraseña inicial a quien te dio de alta, o usá "¿Olvidaste tu contraseña?" en la pantalla de ingreso para elegir una nueva.',
      ],
      button: { label: 'Ir a iniciar sesión', url: loginUrl },
      linkFallback: true,
      note: 'Por seguridad, este mail no incluye tu contraseña.',
    }),
    text: [
      `Hola, ${name}:`,
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
    html: brandedEmail({
      preheader: 'Elegí una contraseña nueva',
      heading: 'Restablecé tu contraseña',
      paragraphs: [
        `Hola, ${esc(name)}:`,
        'Recibimos un pedido para restablecer tu contraseña.',
        'Tocá el botón para elegir una nueva. Tu contraseña actual sigue siendo válida hasta que completes el cambio.',
      ],
      button: { label: 'Elegir nueva contraseña', url },
      linkFallback: true,
      note: `El link vale ${validity} y se puede usar una sola vez. Si no lo pediste vos, ignorá este mail: tu cuenta sigue segura.`,
    }),
    text: [
      `Hola, ${name}:`,
      '',
      'Recibimos un pedido para restablecer tu contraseña de Talarix.',
      'Elegí una nueva desde este link:',
      url,
      '',
      `El link vale ${validity} y se usa una sola vez. Si no lo pediste vos, ignorá este mail.`,
    ].join('\n'),
  };
};
