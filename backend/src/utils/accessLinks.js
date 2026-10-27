import { generateInviteToken, INVITE_TTL_MS } from './inviteToken.js';
import { sendMail, appUrl } from './mailer.js';
import { inviteEmail, resetEmail } from './mailTemplates.js';

export const RESET_TTL_MS = 60 * 60 * 1000;

export const wasIssuedRecently = (user, seconds = 60) => {
  if (!user.inviteTokenHash || !user.inviteExpiresAt) return false;
  const ttl = user.passwordHash ? RESET_TTL_MS : INVITE_TTL_MS;
  const issuedAt = new Date(user.inviteExpiresAt).getTime() - ttl;
  return Date.now() - issuedAt < seconds * 1000;
};

export const issueAccessLink = async (user, businessName) => {
  const isPending = !user.passwordHash;
  const ttl = isPending ? INVITE_TTL_MS : RESET_TTL_MS;

  const { token, hash } = generateInviteToken();
  const expiresAt = new Date(Date.now() + ttl);
  await user.update({ inviteTokenHash: hash, inviteExpiresAt: expiresAt });

  const link = isPending ? appUrl(`/activar?token=${token}`) : appUrl(`/restablecer?token=${token}`);

  const message = isPending
    ? inviteEmail({ name: user.name, businessName, url: link, expiresInMs: ttl })
    : resetEmail({ name: user.name, url: link, expiresInMs: ttl });

  const result = await sendMail({ to: user.email, ...message });

  return {
    type: isPending ? 'invite' : 'reset',
    emailSent: result.sent,
    link,
    expiresAt,
  };
};
