import bcrypt from 'bcryptjs';
import pkg from 'sequelize';
import { User, Business, sequelize } from '../models/index.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { sendMail, appUrl } from '../utils/mailer.js';
import { userCreatedEmail } from '../utils/mailTemplates.js';
import { issueAccessLink } from '../utils/accessLinks.js';
import { checkPassword, BCRYPT_ROUNDS } from '../utils/password.js';
import { audit } from '../utils/audit.js';

const { Op } = pkg;

const ROLES = ['admin', 'editor', 'operador', 'mozo'];
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Los cambios de usuarios de un comercio se hacen de a uno: se bloquea la fila del comercio durante
// la transacción. Así, si dos administradores se quitan el rol al mismo tiempo, el segundo espera
// al primero y ve el resultado (si no, los dos podían pasar y el comercio quedaba sin administrador).
const lockUsersOf = (businessId, transaction) =>
  Business.findOne({ where: { id: businessId }, attributes: ['id'], transaction, lock: transaction.LOCK.UPDATE });

// Antes de quitarle el rol, desactivar o borrar a un administrador: quien lo pide tiene que seguir
// siendo administrador (pudo perder el rol hace un instante) y tiene que quedar otro activo.
// Se leen con bloqueo para ver lo último guardado, no una foto vieja de la transacción.
const assertAnotherAdmin = async (req, targetId, transaction) => {
  const me = await User.findOne({
    where: { id: req.user.id, businessId: req.user.businessId },
    attributes: ['id', 'role', 'active'],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!me || me.role !== 'admin' || !me.active) {
    throw httpError('Ya no sos administrador de este comercio. Volvé a ingresar.', 403);
  }
  const others = await User.findAll({
    where: { businessId: req.user.businessId, role: 'admin', active: true, id: { [Op.ne]: targetId } },
    attributes: ['id'],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });
  if (!others.length) {
    throw httpError('Tiene que quedar al menos un administrador activo en el comercio.', 409);
  }
};

const toSafeUser = (user) => {
  const { passwordHash, inviteTokenHash, inviteExpiresAt, tokenVersion, ...safe } = user.toJSON();
  return { ...safe, pendingActivation: !passwordHash };
};

export const getUsers = asyncHandler(async (req, res) => {
  const users = await User.findAll({
    where: { businessId: req.user.businessId },
    attributes: { exclude: ['inviteTokenHash', 'inviteExpiresAt'] },
    order: [['name', 'ASC']],
  });
  res.json(users.map(toSafeUser));
});

export const createUser = asyncHandler(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '')
    .trim()
    .toLowerCase();
  const password = String(req.body.password || '');
  const sendInvite = req.body.sendInvite === true;
  const { role } = req.body;

  if (!name || !email) throw httpError('Nombre y email son obligatorios');
  if (!EMAIL_REGEX.test(email)) throw httpError('El email no es válido');
  if (role && !ROLES.includes(role)) throw httpError('Rol inválido');

  if (!sendInvite) {
    if (!password) throw httpError('La contraseña es obligatoria');
    checkPassword(password, { email, name });
  }

  // El email es único en todo el sistema (es el usuario para ingresar). El mensaje no dice si es de
  // otro comercio, para no revelar quién usa Talarix.
  const existing = await User.findOne({ where: { email } });
  if (existing) throw httpError('Ese email ya está en uso en Talarix. Usá otro email para este usuario.');

  const user = await User.create({
    name,
    email,
    passwordHash: sendInvite ? null : await bcrypt.hash(password, BCRYPT_ROUNDS),
    role: role || 'operador',
    businessId: req.user.businessId,
  });

  const business = await Business.findByPk(req.user.businessId, { attributes: ['name'] });
  const businessName = business?.name || 'tu comercio';

  let mail;
  if (sendInvite) {
    const result = await issueAccessLink(user, businessName);
    mail = {
      type: 'invite',
      sent: result.emailSent,
      link: result.emailSent ? undefined : result.link,
    };
  } else {
    const creator = await User.findByPk(req.user.id, { attributes: ['name'] });
    const result = await sendMail({
      to: user.email,
      ...userCreatedEmail({
        name: user.name,
        businessName,
        role: user.role,
        creatorName: creator?.name,
        loginUrl: appUrl('/login'),
      }),
    });
    mail = { type: 'created', sent: result.sent };
  }

  await audit(req, {
    action: 'user.created',
    targetType: 'user',
    targetId: user.id,
    detail: { role: user.role, invite: sendInvite },
  });
  res.status(201).json({ ...toSafeUser(user), mail });
});

export const updateUser = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  const { name, role, active, password } = req.body;
  const email = req.body.email !== undefined ? String(req.body.email).trim().toLowerCase() : undefined;
  if (role && !ROLES.includes(role)) throw httpError('Rol inválido');

  const t = await sequelize.transaction();
  let user;
  const changes = {};
  try {
    // Los cambios de usuarios de un mismo comercio se hacen de a uno (ver lockUsersOf)
    await lockUsersOf(businessId, t);
    user = await User.findOne({
      where: { id: req.params.id, businessId },
      transaction: t,
      lock: t.LOCK.UPDATE,
    });
    if (!user) throw httpError('Usuario no encontrado', 404);

    if (user.id === req.user.id && role && role !== 'admin') {
      throw httpError('No podés quitarte tu propio rol de administrador');
    }
    if (user.id === req.user.id && active === false) {
      throw httpError('No podés desactivar tu propio usuario');
    }
    const losesAdmin =
      user.role === 'admin' && user.active && ((role !== undefined && role !== 'admin') || active === false);
    if (losesAdmin) await assertAnotherAdmin(req, user.id, t);

    // Qué cambió, para el registro de auditoría (sin datos personales: solo qué campos y el rol)
    if (role !== undefined && role !== user.role) changes.role = { from: user.role, to: role };
    if (active !== undefined && active !== user.active) changes.active = active;
    if (password) changes.password = true;
    if (email !== undefined && email !== user.email) changes.email = true;

    if (email !== undefined && email !== user.email) {
      const taken = await User.findOne({ where: { email }, transaction: t });
      if (taken) throw httpError('Ese email ya está en uso en Talarix. Usá otro email para este usuario.');
      user.email = email;
    }

    if (name !== undefined) user.name = name;
    if (role !== undefined) user.role = role;
    if (active !== undefined) user.active = active;
    if (password) {
      checkPassword(String(password), { email: user.email, name: user.name });
      user.passwordHash = await bcrypt.hash(String(password), BCRYPT_ROUNDS);
      user.inviteTokenHash = null;
      user.inviteExpiresAt = null;
      user.tokenVersion += 1; // cierra las sesiones abiertas con la contraseña anterior
    }

    await user.save({ transaction: t });
    await t.commit();
  } catch (error) {
    await t.rollback();
    throw error;
  }

  if (Object.keys(changes).length) {
    await audit(req, { action: 'user.updated', targetType: 'user', targetId: user.id, detail: changes });
  }
  res.json(toSafeUser(user));
});

export const sendAccessLink = asyncHandler(async (req, res) => {
  const user = await User.findOne({
    where: { id: req.params.id, businessId: req.user.businessId },
  });
  if (!user) throw httpError('Usuario no encontrado', 404);
  if (!user.active) throw httpError('El usuario está inactivo. Activalo antes de enviarle un link.');

  const business = await Business.findByPk(req.user.businessId, { attributes: ['name'] });
  const result = await issueAccessLink(user, business?.name || 'tu comercio');
  await audit(req, {
    action: 'user.access_link_sent',
    targetType: 'user',
    targetId: user.id,
    detail: { type: result.type },
  });

  res.json({
    email: user.email,
    mail: {
      type: result.type,
      sent: result.emailSent,
      link: result.emailSent ? undefined : result.link,
    },
  });
});

export const deleteUser = asyncHandler(async (req, res) => {
  const { businessId } = req.user;
  if (req.params.id === req.user.id) throw httpError('No podés eliminar tu propio usuario');

  const t = await sequelize.transaction();
  let user;
  try {
    await lockUsersOf(businessId, t);
    user = await User.findOne({ where: { id: req.params.id, businessId }, transaction: t, lock: t.LOCK.UPDATE });
    if (!user) throw httpError('Usuario no encontrado', 404);
    if (user.role === 'admin' && user.active) await assertAnotherAdmin(req, user.id, t);

    await user.destroy({ transaction: t });
    await t.commit();
  } catch (error) {
    await t.rollback();
    throw error;
  }

  await audit(req, { action: 'user.deleted', targetType: 'user', targetId: user.id, detail: { role: user.role } });
  res.status(204).send();
});
