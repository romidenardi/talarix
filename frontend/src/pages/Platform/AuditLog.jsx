import { useEffect, useState, useCallback } from 'react';
import { getAuditLog } from '../../api/platform.api';

// Registro de actividad (tabla audit_logs): quién hizo qué, cuándo y desde qué IP.
const ACTION_LABELS = {
  'platform.login': 'Ingreso a la plataforma',
  'platform.login_failed': 'Ingreso fallido (contraseña)',
  'platform.mfa_failed': 'Ingreso fallido (código)',
  'platform.mfa_enabled': 'Activó el segundo factor',
  'platform.recovery_code_used': 'Usó un código de recuperación',
  'business.created': 'Alta de comercio',
  'business.status_changed': 'Cambio de estado del comercio',
  'business.closure_started': 'Inicio de baja del comercio',
  'business.trial_expired': 'Venció la prueba: comercio suspendido',
  'business.trial_renewed': 'Renovó la prueba',
  'business.modules_changed': 'Cambió los módulos del comercio',
  'tables.settings_changed': 'Activó o desactivó las mesas',
  'tables.item_cancelled': 'Anuló un plato de una mesa',
  'tables.tab_cancelled': 'Anuló una mesa',
  'business.closure_cancelled': 'Baja cancelada',
  'business.purged': 'Comercio eliminado definitivamente',
  'business.exported': 'Exportó los datos del comercio',
  'demo.reset': 'Reinicio de la demo',
  'user.reinvited': 'Nueva invitación al administrador',
  'user.created': 'Alta de usuario',
  'user.updated': 'Cambios en un usuario',
  'user.deleted': 'Baja de usuario',
  'user.access_link_sent': 'Envío de link de acceso',
  'customer.data_exported': 'Exportó los datos de un cliente',
  'customer.anonymized': 'Anonimizó un cliente',
  'order.cancelled': 'Anuló un remito',
  'purchase.cancelled': 'Anuló una compra',
  'order.approved': 'Remito con descuento o precio autorizado',
  'order.approval_failed': 'Autorización de descuento rechazada',
};

const STATUS = { active: 'activo', suspended: 'suspendido', closing: 'en baja' };
const ROLES = { admin: 'administrador', editor: 'editor', operador: 'operador' };
const word = (map, value) => map[value] || value;
const dateOf = (value) => new Date(value).toLocaleDateString('es-AR');

const describe = (row) => {
  const d = row.detail || {};
  switch (row.action) {
    case 'business.created':
      return d.type === 'demo' ? 'Demo' : 'Cliente';
    case 'business.status_changed':
      return `${word(STATUS, d.from)} → ${word(STATUS, d.to)}`;
    case 'business.closure_started':
      return d.deleteAt ? `Se borra el ${new Date(d.deleteAt).toLocaleDateString('es-AR')}` : '';
    case 'business.trial_expired':
      return d.trialEndsAt ? `Vencía el ${dateOf(d.trialEndsAt)}` : '';
    case 'business.trial_renewed':
      return `${d.to ? `Hasta el ${dateOf(d.to)}` : 'Sin vencimiento'}${d.reactivated ? ', reactivado' : ''}`;
    case 'business.modules_changed':
      return d.tables ? `Mesas: ${d.tables.to ? 'activadas' : 'quitadas'}` : '';
    case 'platform.recovery_code_used':
      return `Quedan ${d.left}`;
    case 'order.approved': {
      const parts = [`Autorizó ${d.approver}`];
      if (d.discountPercent > 0) parts.push(`descuento ${d.discountPercent}%`);
      if (d.discountAmount > 0) parts.push(`descuento $${d.discountAmount}`);
      if (d.prices > 0) parts.push(d.prices === 1 ? '1 precio cambiado' : `${d.prices} precios cambiados`);
      return parts.join(', ');
    }
    case 'user.created':
      return `Rol ${word(ROLES, d.role)}${d.invite ? ', con invitación' : ''}`;
    case 'user.deleted':
    case 'user.reinvited':
      return d.role ? `Rol ${word(ROLES, d.role)}` : '';
    case 'user.access_link_sent':
      return d.type === 'reset' ? 'Cambio de contraseña' : 'Invitación';
    case 'user.updated': {
      const parts = [];
      if (d.role) parts.push(`rol ${word(ROLES, d.role.from)} → ${word(ROLES, d.role.to)}`);
      if (d.active !== undefined) parts.push(d.active ? 'reactivado' : 'desactivado');
      if (d.password) parts.push('contraseña');
      if (d.email) parts.push('email');
      return parts.join(', ');
    }
    default:
      return '';
  }
};

const isWarning = (action) =>
  [
    'platform.login_failed',
    'platform.mfa_failed',
    'platform.recovery_code_used',
    'business.purged',
    'order.approval_failed',
  ].includes(action);

export default function AuditLog() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await getAuditLog({ limit: 200 });
      setRows(data);
    } catch (err) {
      setError(err.response?.data?.message || 'No se pudo cargar la actividad');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <section>
      <div className="platform-header">
        <h2>Actividad (últimos 200 registros)</h2>
        <button type="button" onClick={load} disabled={loading}>
          {loading ? 'Cargando…' : 'Actualizar'}
        </button>
      </div>
      {error && <p className="auth-error">{error}</p>}
      {!loading && !error && rows.length === 0 && <p>Todavía no hay actividad registrada.</p>}
      {rows.length > 0 && (
        <div className="platform-table-wrap">
          <table className="platform-table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Quién</th>
                <th>Comercio</th>
                <th>Acción</th>
                <th>Detalle</th>
                <th>IP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className={isWarning(row.action) ? 'audit-warning' : undefined}>
                  <td>{new Date(row.createdAt).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{row.actor}</td>
                  <td>{row.business || '—'}</td>
                  <td>{ACTION_LABELS[row.action] || row.action}</td>
                  <td className="audit-detail">{describe(row) || '—'}</td>
                  <td className="audit-detail">{row.ip || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
