import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import { Business, User, PlatformAdmin, AuditLog, sequelize } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { generateInviteToken, INVITE_TTL_MS } from '../utils/inviteToken.js';
import { sendMail } from '../utils/mailer.js';
import { inviteEmail } from '../utils/mailTemplates.js';
import { closureStartedEmail } from '../utils/closureEmails.js';
import { resetDemoBusiness } from '../services/demo.service.js';
import { audit } from '../utils/audit.js';
import { KEY_RE, dayKey, addDays } from '../utils/dates.js';
import { TRIAL_EXPIRED, MANUAL } from '../services/trialExpiry.service.js';
import { compareWithDummy } from '../utils/password.js';
import {
  generateTotpSecret,
  verifyTotp,
  otpauthUrl,
  generateRecoveryCodes,
  consumeRecoveryCode,
  looksLikeRecoveryCode,
} from '../utils/totp.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const CLOSURE_DAYS = 30;

const buildInviteUrl = (token) => `${process.env.APP_URL.replace(/\/$/, '')}/activar?token=${token}`;

// ---------------------------------------------------------------------------------------------
// Ingreso del superadmin en dos pasos: contraseña y después el código de la app de autenticación.
// 1. POST /login con email y contraseña. Si son correctos devuelve un token corto (mfaToken), que
//    no da acceso a nada: solo sirve para el paso 2. Si el segundo factor todavía no está
//    configurado, el paso 2 es configurarlo (mfaSetupRequired).
// 2a. POST /login/mfa con el código de 6 dígitos (o un código de recuperación) → token de plataforma.
// 2b. Primera vez: POST /login/mfa/setup (muestra el QR) y POST /login/mfa/enable con el primer
//     código → token de plataforma y los 10 códigos de recuperación, que se muestran una sola vez.
// ---------------------------------------------------------------------------------------------
const MFA_TOKEN_TTL = '10m';
const TOTP_ISSUER = 'Talarix';

const signPlatformToken = (admin) =>
  jwt.sign({ adminId: admin.id, scope: 'platform' }, process.env.PLATFORM_JWT_SECRET, { expiresIn: '2h' });

const signMfaToken = (admin, purpose) =>
  jwt.sign({ adminId: admin.id, scope: 'platform-mfa', purpose }, process.env.PLATFORM_JWT_SECRET, {
    expiresIn: MFA_TOKEN_TTL,
  });

// Valida el token del paso 1 y devuelve el superadmin
const adminFromMfaToken = async (token, purpose) => {
  let decoded;
  try {
    decoded = jwt.verify(String(token || ''), process.env.PLATFORM_JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw httpError('El ingreso venció. Volvé a poner tu email y contraseña.', 401);
  }
  if (decoded.scope !== 'platform-mfa' || decoded.purpose !== purpose || !decoded.adminId) {
    throw httpError('El ingreso no es válido. Volvé a empezar.', 401);
  }
  const admin = await PlatformAdmin.findOne({ where: { id: decoded.adminId, active: true } });
  if (!admin) throw httpError('El ingreso no es válido. Volvé a empezar.', 401);
  return admin;
};

const respondWithSession = (res, admin, extra = {}) => {
  res.json({
    token: signPlatformToken(admin),
    admin: { id: admin.id, name: admin.name },
    recoveryCodesLeft: Array.isArray(admin.recoveryCodes) ? admin.recoveryCodes.length : 0,
    ...extra,
  });
};

export const platformLogin = asyncHandler(async (req, res) => {
  const email = String(req.body.email || '')
    .trim()
    .toLowerCase();
  const password = String(req.body.password || '');

  const admin = email ? await PlatformAdmin.findOne({ where: { email } }) : null;
  // Email inexistente: se compara igual contra un hash falso, para que tarde lo mismo
  const matches = admin ? await bcrypt.compare(password, admin.passwordHash) : await compareWithDummy(password);
  const valid = admin && admin.active && matches;
  if (!valid) {
    await audit(req, {
      action: 'platform.login_failed',
      actorType: 'platform',
      actorId: admin?.id ?? null,
      businessId: null,
    });
    throw httpError('Credenciales inválidas', 401);
  }

  if (!admin.totpEnabled) {
    return res.json({ mfaSetupRequired: true, mfaToken: signMfaToken(admin, 'setup') });
  }
  res.json({ mfaRequired: true, mfaToken: signMfaToken(admin, 'verify') });
});

export const platformLoginMfa = asyncHandler(async (req, res) => {
  const admin = await adminFromMfaToken(req.body.mfaToken, 'verify');
  const code = String(req.body.code || '').trim();
  const who = { actorType: 'platform', actorId: admin.id, businessId: null };

  if (looksLikeRecoveryCode(code)) {
    const remaining = consumeRecoveryCode(admin.recoveryCodes, code);
    if (!remaining) {
      await audit(req, { action: 'platform.mfa_failed', ...who });
      throw httpError('El código de recuperación no es válido o ya se usó', 401);
    }
    await admin.update({ recoveryCodes: remaining });
    await audit(req, { action: 'platform.recovery_code_used', detail: { left: remaining.length }, ...who });
    await audit(req, { action: 'platform.login', ...who });
    return respondWithSession(res, admin, { usedRecoveryCode: true });
  }

  const step = verifyTotp(admin.totpSecret, code, { lastStep: admin.totpLastStep });
  if (step === null) {
    await audit(req, { action: 'platform.mfa_failed', ...who });
    throw httpError('El código no es correcto. Fijate el que muestra ahora la app y probá de nuevo.', 401);
  }
  await admin.update({ totpLastStep: step });
  await audit(req, { action: 'platform.login', ...who });
  respondWithSession(res, admin);
});

export const platformMfaSetup = asyncHandler(async (req, res) => {
  const admin = await adminFromMfaToken(req.body.mfaToken, 'setup');
  if (admin.totpEnabled) throw httpError('El segundo factor ya está configurado. Volvé a ingresar.', 409);

  const secret = generateTotpSecret();
  await admin.update({ totpPendingSecret: secret });

  const url = otpauthUrl({ issuer: TOTP_ISSUER, account: admin.email, secret });
  const qrDataUrl = await QRCode.toDataURL(url, { margin: 1, width: 220 });
  res.json({ secret, qrDataUrl });
});

export const platformMfaEnable = asyncHandler(async (req, res) => {
  const admin = await adminFromMfaToken(req.body.mfaToken, 'setup');
  if (admin.totpEnabled) throw httpError('El segundo factor ya está configurado. Volvé a ingresar.', 409);
  if (!admin.totpPendingSecret) throw httpError('Primero escaneá el código QR');

  const step = verifyTotp(admin.totpPendingSecret, req.body.code);
  if (step === null) {
    throw httpError('El código no es correcto. Fijate el que muestra ahora la app y probá de nuevo.');
  }

  const { codes, hashes } = generateRecoveryCodes();
  await admin.update({
    totpEnabled: true,
    totpSecret: admin.totpPendingSecret,
    totpPendingSecret: null,
    totpLastStep: step,
    recoveryCodes: hashes,
  });
  const who = { actorType: 'platform', actorId: admin.id, businessId: null };
  await audit(req, { action: 'platform.mfa_enabled', ...who });
  await audit(req, { action: 'platform.login', ...who });
  respondWithSession(res, admin, { recoveryCodes: codes });
});

// Últimos movimientos del registro de auditoría, con nombres legibles
export const listAuditLog = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
  const where = {};
  if (req.query.businessId) where.businessId = String(req.query.businessId);

  const rows = await AuditLog.findAll({ where, order: [['createdAt', 'DESC']], limit });

  const ids = (type) => [...new Set(rows.filter((r) => r.actorType === type && r.actorId).map((r) => r.actorId))];
  const businessIds = [...new Set(rows.map((r) => r.businessId).filter(Boolean))];
  const [admins, users, businesses] = await Promise.all([
    PlatformAdmin.findAll({ where: { id: ids('platform') }, attributes: ['id', 'email'] }),
    User.findAll({ where: { id: ids('user') }, attributes: ['id', 'email'] }),
    Business.findAll({ where: { id: businessIds }, attributes: ['id', 'name'] }),
  ]);
  const label = new Map([...admins, ...users].map((x) => [x.id, x.email]));
  const businessName = new Map(businesses.map((b) => [b.id, b.name]));

  res.json(
    rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      action: r.action,
      actorType: r.actorType,
      actor: r.actorType === 'system' ? 'Sistema' : label.get(r.actorId) || (r.actorId ? 'Usuario borrado' : '—'),
      business: r.businessId ? businessName.get(r.businessId) || 'Comercio borrado' : null,
      targetType: r.targetType,
      targetId: r.targetId,
      detail: r.detail,
      ip: r.ip,
    })),
  );
});

export const listBusinesses = asyncHandler(async (req, res) => {
  const businesses = await Business.findAll({
    attributes: [
      'id',
      'name',
      'status',
      'suspendedReason',
      'type',
      'trialEndsAt',
      'deleteAt',
      'contactEmail',
      'createdAt',
    ],
    order: [['createdAt', 'DESC']],
  });

  const users = await User.findAll({
    attributes: [
      'id',
      'businessId',
      'name',
      'email',
      'role',
      'active',
      'lastLoginAt',
      'passwordHash',
      'inviteExpiresAt',
    ],
  });

  const result = businesses.map((business) => {
    const members = users.filter((u) => u.businessId === business.id);
    return {
      ...business.toJSON(),
      userCount: members.length,
      admins: members
        .filter((u) => u.role === 'admin')
        .map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          active: u.active,
          lastLoginAt: u.lastLoginAt,
          pendingActivation: !u.passwordHash,
          inviteExpiresAt: u.passwordHash ? null : u.inviteExpiresAt,
        })),
    };
  });

  res.json(result);
});

export const createBusiness = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const adminName = String(req.body.adminName || '').trim();
  const adminEmail = String(req.body.adminEmail || '')
    .trim()
    .toLowerCase();
  const type = req.body.type === 'demo' ? 'demo' : 'client';

  if (!name || !adminName || !adminEmail) {
    throw httpError('Nombre del comercio, nombre del administrador y email son obligatorios');
  }
  if (!EMAIL_REGEX.test(adminEmail)) throw httpError('El email no es válido');

  let trialEndsAt = null;
  if (req.body.trialDays !== undefined && req.body.trialDays !== null && req.body.trialDays !== '') {
    const days = Number(req.body.trialDays);
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      throw httpError('Los días de prueba deben ser un entero entre 1 y 365');
    }
    trialEndsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }

  const existing = await User.findOne({ where: { email: adminEmail } });
  if (existing) throw httpError('Ya existe un usuario con ese email', 409);

  const { token, hash } = generateInviteToken();
  const inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS);

  const t = await sequelize.transaction();
  let business;
  try {
    business = await Business.create({ name, type, trialEndsAt, contactEmail: adminEmail }, { transaction: t });
    await User.create(
      {
        name: adminName,
        email: adminEmail,
        role: 'admin',
        passwordHash: null,
        inviteTokenHash: hash,
        inviteExpiresAt,
        businessId: business.id,
      },
      { transaction: t },
    );
    await t.commit();
  } catch (error) {
    await t.rollback();
    throw error;
  }

  await audit(req, {
    action: 'business.created',
    businessId: business.id,
    targetType: 'business',
    targetId: business.id,
    detail: { type },
  });

  let demoSeeded = null;
  if (type === 'demo') {
    try {
      await resetDemoBusiness(business.id);
      demoSeeded = true;
    } catch (error) {
      console.error('[demo] No se pudieron cargar los datos de ejemplo:', error);
      demoSeeded = false;
    }
  }

  const inviteUrl = buildInviteUrl(token);
  const mail = await sendMail({
    to: adminEmail,
    ...inviteEmail({
      name: adminName,
      businessName: name,
      url: inviteUrl,
      expiresInMs: INVITE_TTL_MS,
    }),
  });

  res.status(201).json({
    business: { id: business.id, name: business.name, type: business.type, status: business.status },
    inviteUrl,
    inviteExpiresAt,
    emailSent: mail.sent,
    demoSeeded,
  });
});

export const setBusinessStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!['active', 'suspended'].includes(status)) throw httpError('Estado inválido');

  const business = await Business.findByPk(req.params.id);
  if (!business) throw httpError('Comercio no encontrado', 404);

  if (business.status === 'closing') {
    throw httpError('El comercio tiene una baja pendiente. Cancelá la baja antes de cambiar su estado.', 409);
  }

  // Con la prueba vencida no se reactiva sin más: la tarea programada lo volvería a suspender.
  // Hay que renovarla (PATCH /businesses/:id/trial), que además lo reactiva.
  if (status === 'active' && business.trialEndsAt && business.trialEndsAt <= new Date()) {
    throw httpError(
      'La prueba de este comercio venció. Renovala con una fecha nueva o sin vencimiento.',
      409,
      'TRIAL_EXPIRED',
    );
  }

  const previous = business.status;
  await business.update({ status, suspendedReason: status === 'suspended' ? MANUAL : null });
  await audit(req, {
    action: 'business.status_changed',
    businessId: business.id,
    targetType: 'business',
    targetId: business.id,
    detail: { from: previous, to: status },
  });
  res.json({ id: business.id, name: business.name, status: business.status });
});

// Renovar o cambiar el vencimiento de la prueba: { until: 'AAAA-MM-DD' } (vence al terminar ese día,
// hora argentina) o { until: null } (sin vencimiento). Si estaba suspendido por la prueba, lo reactiva.
const MAX_TRIAL_DAYS = 3 * 366;

export const setBusinessTrial = asyncHandler(async (req, res) => {
  const business = await Business.findByPk(req.params.id);
  if (!business) throw httpError('Comercio no encontrado', 404);
  if (business.type !== 'client') throw httpError('La cuenta demo no tiene período de prueba');
  if (business.status === 'closing') {
    throw httpError('El comercio tiene una baja pendiente. Cancelá la baja antes de renovar la prueba.', 409);
  }

  const { until } = req.body;
  let trialEndsAt = null;
  if (until !== null) {
    if (typeof until !== 'string' || !KEY_RE.test(until)) {
      throw httpError('Indicá la fecha (AAAA-MM-DD) o "sin vencimiento"');
    }
    trialEndsAt = new Date(`${until}T23:59:59-03:00`);
    if (Number.isNaN(trialEndsAt.getTime()) || dayKey(trialEndsAt) !== until) throw httpError('Fecha inválida');
    const today = dayKey(new Date());
    if (until < today) throw httpError('La fecha no puede ser anterior a hoy');
    if (until > addDays(today, MAX_TRIAL_DAYS)) throw httpError('La fecha puede ser hasta dentro de 3 años');
  }

  const previous = business.trialEndsAt;
  const reactivate = business.status === 'suspended' && business.suspendedReason === TRIAL_EXPIRED;
  await business.update({
    trialEndsAt,
    ...(reactivate ? { status: 'active', suspendedReason: null } : {}),
  });
  await audit(req, {
    action: 'business.trial_renewed',
    businessId: business.id,
    targetType: 'business',
    targetId: business.id,
    detail: { from: previous, to: trialEndsAt, reactivated: reactivate },
  });

  res.json({
    id: business.id,
    name: business.name,
    status: business.status,
    suspendedReason: business.suspendedReason,
    trialEndsAt: business.trialEndsAt,
    reactivated: reactivate,
  });
});

export const startClosure = asyncHandler(async (req, res) => {
  const business = await Business.findByPk(req.params.id);
  if (!business) throw httpError('Comercio no encontrado', 404);

  if (business.type === 'demo') throw httpError('La cuenta demo no se da de baja');
  if (business.status === 'closing') throw httpError('El comercio ya tiene una baja pendiente', 409);

  if (String(req.body.confirmName || '').trim() !== business.name) {
    throw httpError('El nombre de confirmación no coincide con el del comercio');
  }

  const deleteAt = new Date(Date.now() + CLOSURE_DAYS * 24 * 60 * 60 * 1000);
  await business.update({ status: 'closing', deleteAt });
  await audit(req, {
    action: 'business.closure_started',
    businessId: business.id,
    targetType: 'business',
    targetId: business.id,
    detail: { deleteAt },
  });

  const admins = await User.findAll({
    where: { businessId: business.id, role: 'admin', active: true },
    attributes: ['name', 'email'],
  });

  let emailsSent = 0;
  for (const admin of admins) {
    try {
      const mail = await sendMail({
        to: admin.email,
        ...closureStartedEmail({ name: admin.name, businessName: business.name, deleteAt }),
      });
      if (mail.sent) emailsSent += 1;
    } catch (error) {
      console.error('[platform] No se pudo enviar el aviso de baja:', error.message);
    }
  }

  res.json({
    id: business.id,
    name: business.name,
    status: business.status,
    deleteAt,
    adminCount: admins.length,
    emailsSent,
  });
});

export const cancelClosure = asyncHandler(async (req, res) => {
  const business = await Business.findByPk(req.params.id);
  if (!business) throw httpError('Comercio no encontrado', 404);
  if (business.status !== 'closing') throw httpError('El comercio no tiene una baja pendiente', 409);

  await business.update({ status: 'active', suspendedReason: null, deleteAt: null });
  await audit(req, {
    action: 'business.closure_cancelled',
    businessId: business.id,
    targetType: 'business',
    targetId: business.id,
  });
  res.json({ id: business.id, name: business.name, status: business.status });
});

export const reinviteUser = asyncHandler(async (req, res) => {
  const business = await Business.findByPk(req.params.id);
  if (!business) throw httpError('Comercio no encontrado', 404);

  const where = req.body.userId
    ? { id: req.body.userId, businessId: business.id }
    : { businessId: business.id, role: 'admin' };
  const user = await User.findOne({ where, order: [['createdAt', 'ASC']] });
  if (!user) throw httpError('Usuario no encontrado', 404);

  const { token, hash } = generateInviteToken();
  const inviteExpiresAt = new Date(Date.now() + INVITE_TTL_MS);

  await user.update({ passwordHash: null, inviteTokenHash: hash, inviteExpiresAt, active: true });
  await audit(req, {
    action: 'user.reinvited',
    businessId: business.id,
    targetType: 'user',
    targetId: user.id,
    detail: { role: user.role },
  });

  const inviteUrl = buildInviteUrl(token);
  const mail = await sendMail({
    to: user.email,
    ...inviteEmail({
      name: user.name,
      businessName: business.name,
      url: inviteUrl,
      expiresInMs: INVITE_TTL_MS,
    }),
  });

  res.json({
    user: { id: user.id, name: user.name, email: user.email },
    inviteUrl,
    inviteExpiresAt,
    emailSent: mail.sent,
  });
});

export const resetDemo = asyncHandler(async (req, res) => {
  await resetDemoBusiness(req.params.id);
  await audit(req, {
    action: 'demo.reset',
    businessId: req.params.id,
    targetType: 'business',
    targetId: req.params.id,
  });
  res.json({ message: 'Demo reiniciada' });
});
