// Mails de los botones de baja y de arrepentimiento y del pedido de demo del sitio: la constancia
// para quien lo pidió y el aviso a la casilla de soporte para atenderlo. Usan el diseño común de
// utils/emailLayout.js y van también en texto plano.
import { brandedEmail, esc, supportEmail } from './emailLayout.js';
import { appUrl } from './mailer.js';

export { supportEmail };

export const KIND_LABELS = { cancellation: 'baja', withdrawal: 'arrepentimiento', demo: 'demo' };

const supportLink = () => `<a href="mailto:${esc(supportEmail())}" style="color:#2e7eb0;">${esc(supportEmail())}</a>`;

// Para quien hizo el pedido
export const requestReceivedEmail = ({ kind, code, name }) => {
  if (kind === 'demo') {
    const lines = [
      `Hola, ${name}:`,
      '¡Gracias por tu interés en Talarix! Recibimos tu pedido de demo.',
      'Te vamos a escribir en breve para coordinar un horario y mostrarte el sistema funcionando.',
      `Si tenés alguna consulta mientras tanto, escribinos a ${supportEmail()}.`,
    ];
    return {
      subject: 'Recibimos tu pedido de demo de Talarix',
      text: lines.join('\n\n'),
      html: brandedEmail({
        preheader: 'Te escribimos en breve para coordinar la demo',
        heading: 'Recibimos tu pedido de demo',
        paragraphs: [
          `Hola, ${esc(name)}:`,
          '¡Gracias por tu interés en Talarix!',
          'Te vamos a escribir en breve para coordinar un horario y mostrarte el sistema funcionando.',
        ],
        note: `Si tenés alguna consulta mientras tanto, escribinos a ${supportLink()}.`,
      }),
    };
  }

  const withdrawal = kind === 'withdrawal';
  const intro = withdrawal
    ? 'Recibimos la solicitud de arrepentimiento de la contratación de tu Plan Pago de Talarix.'
    : 'Recibimos la solicitud de baja de tu cuenta de Talarix.';
  const next = withdrawal
    ? ['Te vamos a escribir para coordinar la devolución de lo que hayas abonado.']
    : [
        'La baja no tiene costo. Te vamos a escribir para confirmarla. Desde ese momento, el administrador ' +
          'de la cuenta tiene 30 días para descargar los datos; después se eliminan.',
      ];
  const lines = [
    withdrawal ? `Hola, ${name}.` : `Hola, ${name}:`,
    intro,
    `El código de la solicitud es ${code}.`,
    ...next,
    `Si no hiciste este pedido, escribinos a ${supportEmail()}.`,
  ];
  return {
    subject: `Recibimos tu solicitud de ${KIND_LABELS[kind]} · Código ${code}`,
    text: lines.join('\n\n'),
    html: brandedEmail({
      preheader: `Código ${code}`,
      heading: `Recibimos tu solicitud de ${KIND_LABELS[kind]}`,
      paragraphs: [esc(lines[0]), esc(intro)],
      highlight: { label: 'Código de la solicitud', value: code },
      note: [...next.map(esc), `Si no hiciste este pedido, escribinos a ${supportLink()}.`].join('<br><br>'),
    }),
  };
};

// Para la casilla de soporte
export const requestNoticeEmail = ({ kind, code, name, email, businessName, reason, matchedBusiness }) => {
  const demo = kind === 'demo';
  const rows = [
    ['Nombre', name],
    ['Email', email],
    [demo ? 'Empresa' : 'Comercio indicado', businessName || '(no lo indicó)'],
    ['Comercio de ese email en Talarix', matchedBusiness || 'ninguno'],
    ...(reason ? [[demo ? 'Comentarios' : 'Motivo', reason]] : []),
  ];
  const lines = [
    `Nueva solicitud de ${KIND_LABELS[kind]}: ${code}`,
    ...rows.map(([label, value]) => `${label}: ${value}`),
    'Atendela desde el panel de plataforma (Solicitudes) y marcala como resuelta.',
  ];
  const subject = demo
    ? `Pedido de demo ${code}: ${businessName || name}`
    : `Solicitud de ${KIND_LABELS[kind]} ${code}`;
  const panel = appUrl('/plataforma');
  return {
    subject,
    text: lines.join('\n\n'),
    html: brandedEmail({
      preheader: `${name} · ${email}`,
      heading: demo ? 'Nuevo pedido de demo' : `Nueva solicitud de ${KIND_LABELS[kind]}`,
      highlight: { label: 'Código', value: code },
      details: rows,
      ...(panel.startsWith('http') ? { button: { label: 'Abrir el panel de plataforma', url: panel } } : {}),
      note: 'Atendela desde el panel de plataforma (Solicitudes) y marcala como resuelta.',
    }),
  };
};
