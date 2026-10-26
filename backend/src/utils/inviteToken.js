import crypto from 'crypto';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

export const generateInviteToken = () => {
  const token = crypto.randomBytes(32).toString('hex');
  return { token, hash: hashToken(token) };
};
