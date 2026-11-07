// Mails de los botones de baja y de arrepentimiento: la constancia para quien lo pidió (con el código)
// y el aviso a la casilla de soporte para atenderlo.

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const supportEmail = () => process.env.SUPPORT_EMAIL || 'hola@talarix.com.ar';

export const KIND_LABELS = { cancellation: 'baja', withdrawal: 'arrepentimiento' };

const paragraphs = (lines) => ({
  text: lines.join('\n\n'),
  html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join(''),
});

// Para quien hizo el pedido
export const requestReceivedEmail = ({ kind, code, name, businessName }) => {
  const of = businessName ? ` de "${businessName}"` : '';
  const lines =
    kind === 'withdrawal'
      ? [
          `Hola ${name},`,
          `Recibimos tu solicitud de arrepentimiento de la contratación del Plan Pago de Talarix${of}.`,
          `Código de la solicitud: ${code}`,
          'Te devolvemos la totalidad de lo abonado. Te vamos a escribir para coordinar la devolución.',
          `Si no hiciste este pedido, respondé este mail o escribinos a ${supportEmail()}.`,
        ]
      : [
          `Hola ${name},`,
          `Recibimos tu solicitud de baja de la cuenta de Talarix${of}.`,
          `Código de la solicitud: ${code}`,
          'La baja no tiene costo. Te vamos a escribir para confirmarla. Desde ese momento, el administrador ' +
            'de la cuenta tiene 30 días para descargar los datos; después se eliminan.',
          `Si no hiciste este pedido, respondé este mail o escribinos a ${supportEmail()}.`,
        ];
  return {
    subject: `Recibimos tu solicitud de ${KIND_LABELS[kind]} · Código ${code}`,
    ...paragraphs(lines),
  };
};

// Para la casilla de soporte
export const requestNoticeEmail = ({ kind, code, name, email, businessName, reason, matchedBusiness }) => {
  const lines = [
    `Nueva solicitud de ${KIND_LABELS[kind]}: ${code}`,
    `Nombre: ${name}`,
    `Email: ${email}`,
    `Comercio indicado: ${businessName || '(no lo indicó)'}`,
    `Comercio de ese email en Talarix: ${matchedBusiness || 'ninguno'}`,
    ...(reason ? [`Motivo: ${reason}`] : []),
    'Atendela desde el panel de plataforma (Solicitudes) y marcala como resuelta.',
  ];
  return { subject: `Solicitud de ${KIND_LABELS[kind]} ${code}`, ...paragraphs(lines) };
};
