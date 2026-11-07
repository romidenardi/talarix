import { randomInt } from 'node:crypto';
import { ServiceRequest, User, Business } from '../models/index.js';
import { httpError } from '../utils/httpError.js';
import { sendMail } from '../utils/mailer.js';
import { audit } from '../utils/audit.js';
import { requestReceivedEmail, requestNoticeEmail, supportEmail } from '../utils/serviceRequestEmails.js';

// Botones de baja (Res. 316/2018) y de arrepentimiento (Res. 424/2020): cualquiera los usa sin
// ingresar, y recibe al instante un código por mail. El superadmin los atiende desde su panel.
export const KINDS = { cancellation: 'BAJ', withdrawal: 'ARR' };
export const STATUSES = ['pending', 'done'];

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Sin letras ni números que se confunden al dictarlos (0/O, 1/I/L)
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

const newCode = (kind) =>
  `${KINDS[kind]}-${Array.from({ length: 8 }, () => CODE_CHARS[randomInt(CODE_CHARS.length)]).join('')}`;

const text = (value, max) => {
  const clean = String(value ?? '').trim();
  return clean ? clean.slice(0, max) : null;
};

export const readRequest = (body) => {
  const kind = String(body.kind || '');
  if (!KINDS[kind]) throw httpError('Tipo de solicitud inválido');
  const name = text(body.name, 255);
  if (!name) throw httpError('Escribí tu nombre');
  const email = String(body.email ?? '')
    .trim()
    .toLowerCase();
  if (!EMAIL_REGEX.test(email)) throw httpError('El email no es válido');
  return {
    kind,
    name,
    email,
    businessName: text(body.businessName, 255),
    reason: kind === 'cancellation' ? text(body.reason, 2000) : null,
  };
};

// Crea el pedido y manda los dos mails. Responde lo mismo exista o no una cuenta con ese email:
// así el formulario no sirve para averiguar quién usa Talarix.
export const createServiceRequest = async (body, req) => {
  const data = readRequest(body);
  const user = await User.findOne({
    where: { email: data.email },
    attributes: ['id', 'businessId'],
    include: [{ model: Business, attributes: ['id', 'name'] }],
  });

  let request;
  for (let attempt = 0; !request; attempt += 1) {
    try {
      request = await ServiceRequest.create({
        ...data,
        code: newCode(data.kind),
        businessId: user?.businessId || null,
        ip: req?.ip ? String(req.ip).slice(0, 64) : null,
      });
    } catch (err) {
      // Dos códigos iguales es casi imposible (31^8), pero si pasa se genera otro
      if (err?.name !== 'SequelizeUniqueConstraintError' || attempt >= 2) throw err;
    }
  }

  await audit(req, {
    action: `service_request.${data.kind}`,
    actorType: 'system',
    businessId: request.businessId,
    targetType: 'service_request',
    targetId: request.id,
    detail: { code: request.code },
  });

  const [received] = await Promise.all([
    sendMail({ to: request.email, ...requestReceivedEmail(request) }),
    sendMail({
      to: supportEmail(),
      ...requestNoticeEmail({ ...request.get({ plain: true }), matchedBusiness: user?.Business?.name }),
    }),
  ]);

  return { code: request.code, kind: request.kind, emailSent: received.sent };
};

// Para el panel del superadmin: pendientes primero, después los más nuevos
export const listServiceRequests = async ({ status } = {}) => {
  const where = STATUSES.includes(status) ? { status } : {};
  const rows = await ServiceRequest.findAll({
    where,
    order: [
      ['status', 'DESC'],
      ['createdAt', 'DESC'],
    ],
    limit: 200,
  });
  const businessIds = [...new Set(rows.map((r) => r.businessId).filter(Boolean))];
  const businesses = businessIds.length
    ? await Business.findAll({ where: { id: businessIds }, attributes: ['id', 'name', 'status'] })
    : [];
  const byId = new Map(businesses.map((b) => [b.id, b]));
  return rows.map((r) => ({
    ...r.get({ plain: true }),
    business: r.businessId ? (byId.get(r.businessId)?.get({ plain: true }) ?? { name: 'Comercio borrado' }) : null,
  }));
};

export const resolveServiceRequest = async (id, body, req) => {
  const request = await ServiceRequest.findByPk(id);
  if (!request) throw httpError('Solicitud no encontrada', 404);
  const status = body.status === undefined ? 'done' : String(body.status);
  if (!STATUSES.includes(status)) throw httpError('Estado inválido');

  await request.update({
    status,
    note: body.note === undefined ? request.note : text(body.note, 500),
    resolvedAt: status === 'done' ? request.resolvedAt || new Date() : null,
  });
  await audit(req, {
    action: status === 'done' ? 'service_request.resolved' : 'service_request.reopened',
    businessId: request.businessId,
    targetType: 'service_request',
    targetId: request.id,
    detail: { code: request.code },
  });
  return request;
};
