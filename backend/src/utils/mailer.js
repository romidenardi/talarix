import nodemailer from 'nodemailer';

let transporter = null;

export const isMailConfigured = () => Boolean(process.env.MAIL_HOST && process.env.MAIL_FROM);

const getTransporter = () => {
  if (transporter) return transporter;

  const port = Number(process.env.MAIL_PORT) || 587;
  const secure = process.env.MAIL_SECURE ? process.env.MAIL_SECURE === 'true' : port === 465;

  transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST,
    port,
    secure,
    auth: process.env.MAIL_USER ? { user: process.env.MAIL_USER, pass: process.env.MAIL_PASS } : undefined,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
  return transporter;
};

export const sendMail = async ({ to, subject, html, text }) => {
  if (!isMailConfigured()) {
    console.warn('[mail] Envío de mails sin configurar (MAIL_HOST / MAIL_FROM). No se envió:', subject);
    return { sent: false, reason: 'not_configured' };
  }

  try {
    await getTransporter().sendMail({
      from: process.env.MAIL_FROM,
      to,
      subject,
      html,
      text,
    });
    return { sent: true };
  } catch (error) {
    console.error('[mail] No se pudo enviar a', to, '-', error.message);
    return { sent: false, reason: 'send_failed' };
  }
};

export const appUrl = (path = '') => `${String(process.env.APP_URL || '').replace(/\/$/, '')}${path}`;
