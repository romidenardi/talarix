// Mails de los botones de baja y de arrepentimiento y del pedido de demo del sitio: la constancia
// para quien lo pidió y el aviso a la casilla de soporte para atenderlo.

const escapeHtml = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

export const supportEmail = () => process.env.SUPPORT_EMAIL || 'hola@talarix.com.ar';

export const KIND_LABELS = { cancellation: 'baja', withdrawal: 'arrepentimiento', demo: 'demo' };

const paragraphs = (lines) => ({
  text: lines.join('\n\n'),
  html: lines.map((line) => `<p>${escapeHtml(line)}</p>`).join(''),
});

// Para quien hizo el pedido
export const requestReceivedEmail = ({ kind, code, name }) => {
  if (kind === 'demo') {
    return {
      subject: 'Recibimos tu pedido de demo de Talarix',
      ...paragraphs([
        `Hola, ${name}:`,
        '¡Gracias por tu interés en Talarix! Recibimos tu pedido de demo.',
        'Te vamos a escribir en breve para coordinar un horario y mostrarte el sistema funcionando.',
        `Si tenés alguna consulta mientras tanto, escribinos a ${supportEmail()}.`,
      ]),
    };
  }
  const lines =
    kind === 'withdrawal'
      ? [
          `Hola, ${name}.`,
          'Recibimos la solicitud de arrepentimiento de la contratación de tu Plan Pago de Talarix.',
          `El código de la solicitud es ${code}.`,
          'Te vamos a escribir para coordinar la devolución de lo que hayas abonado.',
          `Si no hiciste este pedido, escribinos a ${supportEmail()}.`,
        ]
      : [
          `Hola, ${name}:`,
          'Recibimos la solicitud de baja de tu cuenta de Talarix.',
          `El código de la solicitud es ${code}.`,
          'La baja no tiene costo. Te vamos a escribir para confirmarla. Desde ese momento, el administrador ' +
            'de la cuenta tiene 30 días para descargar los datos; después se eliminan.',
          `Si no hiciste este pedido, escribinos a ${supportEmail()}.`,
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
    `${kind === 'demo' ? 'Empresa' : 'Comercio indicado'}: ${businessName || '(no lo indicó)'}`,
    `Comercio de ese email en Talarix: ${matchedBusiness || 'ninguno'}`,
    ...(reason ? [`${kind === 'demo' ? 'Comentarios' : 'Motivo'}: ${reason}`] : []),
    'Atendela desde el panel de plataforma (Solicitudes) y marcala como resuelta.',
  ];
  const subject =
    kind === 'demo' ? `Pedido de demo ${code}: ${businessName || name}` : `Solicitud de ${KIND_LABELS[kind]} ${code}`;
  return { subject, ...paragraphs(lines) };
};
