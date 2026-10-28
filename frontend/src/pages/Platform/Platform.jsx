import { useEffect, useState, useCallback } from 'react';
import { useDialog } from '../../context/DialogContext.jsx';
import { Navigate, useNavigate } from 'react-router-dom';
import {
  getPlatformToken,
  clearPlatformToken,
  getBusinesses,
  createBusiness,
  setBusinessStatus,
  setBusinessTrial,
  setBusinessModules,
  reinviteBusinessAdmin,
  resetDemoBusiness,
  startBusinessClosure,
  cancelBusinessClosure,
} from '../../api/platform.api';
import AuditLog from './AuditLog';
import TrialDialog from './TrialDialog';

const EMPTY_FORM = { name: '', adminName: '', adminEmail: '', type: 'client', trialDays: '' };

const formatDate = (value, withTime = false) => {
  if (!value) return '—';
  const date = new Date(value);
  return withTime
    ? date.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
    : date.toLocaleDateString('es-AR');
};

const errorMessage = (err) => err.response?.data?.message || 'Ocurrió un error. Probá de nuevo.';

const STATUS_LABELS = {
  active: 'Activo',
  suspended: 'Suspendido',
  closing: 'En baja',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WARN_DAYS = 3;
const TRIAL_EXPIRED = 'trial_expired';

// Pruebas que vencen en los próximos 3 días, y las ya vencidas (suspendidas por la tarea programada)
const trialAlerts = (businesses, now = new Date()) => {
  const soon = [];
  const expired = [];
  for (const business of businesses) {
    if (business.type !== 'client') continue;
    if (business.status === 'suspended' && business.suspendedReason === TRIAL_EXPIRED) {
      expired.push(business);
    } else if (business.status === 'active' && business.trialEndsAt) {
      const left = new Date(business.trialEndsAt) - now;
      if (left <= WARN_DAYS * DAY_MS) soon.push(business);
    }
  }
  const byDate = (a, b) => new Date(a.trialEndsAt) - new Date(b.trialEndsAt);
  return { soon: soon.sort(byDate), expired: expired.sort(byDate) };
};

const whenLeft = (trialEndsAt) => {
  const end = new Date(trialEndsAt);
  const days = Math.round((new Date(end.toDateString()) - new Date(new Date().toDateString())) / DAY_MS);
  if (days <= 0) return 'hoy';
  if (days === 1) return 'mañana';
  return `en ${days} días`;
};

const STATUS_CLASSES = {
  active: 'platform-badge-ok',
  suspended: 'platform-badge-off',
  closing: 'platform-badge-warn',
};

export default function Platform() {
  const navigate = useNavigate();
  const dialog = useDialog();
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [invite, setInvite] = useState(null);
  const [copied, setCopied] = useState(false);
  const [renewing, setRenewing] = useState(null);
  const [savingTrial, setSavingTrial] = useState(false);

  const load = useCallback(async () => {
    try {
      const { data } = await getBusinesses();
      setBusinesses(data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (getPlatformToken()) load();
  }, [load]);

  if (!getPlatformToken()) return <Navigate to="/plataforma/login" replace />;

  const setField = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleLogout = () => {
    clearPlatformToken();
    navigate('/plataforma/login');
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = {
        name: form.name.trim(),
        adminName: form.adminName.trim(),
        adminEmail: form.adminEmail.trim(),
        type: form.type,
      };
      if (form.trialDays) payload.trialDays = Number(form.trialDays);

      const { data } = await createBusiness(payload);
      setInvite({
        title: `Link de activación para ${data.business.name}`,
        url: data.inviteUrl,
        expires: data.inviteExpiresAt,
        email: payload.adminEmail,
        emailSent: data.emailSent === true,
      });
      setCopied(false);
      setForm(EMPTY_FORM);
      if (data.demoSeeded === false) {
        setError('El comercio se creó, pero fallaron los datos de ejemplo. Usá "Reiniciar demo" para cargarlos.');
      }
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleStatus = async (business) => {
    const next = business.status === 'active' ? 'suspended' : 'active';
    // Con la prueba vencida, reactivar es renovarla
    const trialOver = business.trialEndsAt && new Date(business.trialEndsAt) <= new Date();
    if (next === 'active' && trialOver) {
      setRenewing(business);
      return;
    }
    const message =
      next === 'suspended'
        ? `¿Suspender "${business.name}"? Los usuarios no van a poder ingresar.`
        : `¿Reactivar "${business.name}"?`;
    if (
      !(await dialog.confirm({
        message,
        confirmLabel: next === 'suspended' ? 'Suspender' : 'Reactivar',
        danger: next === 'suspended',
      }))
    )
      return;

    setError('');
    try {
      await setBusinessStatus(business.id, next);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleRenewClosed = async (result) => {
    if (!result) {
      setRenewing(null);
      return;
    }
    setError('');
    setSavingTrial(true);
    try {
      const { data } = await setBusinessTrial(renewing.id, result.until);
      setRenewing(null);
      await load();
      const until = data.trialEndsAt ? `hasta el ${formatDate(data.trialEndsAt)}` : 'sin vencimiento';
      await dialog.alert({
        title: 'Prueba renovada',
        message:
          `${data.name}: ${until}.` +
          (data.reactivated ? '\nEl comercio se reactivó: ya pueden volver a ingresar.' : '') +
          (data.status === 'suspended' ? '\nSigue suspendido a mano: reactivalo si corresponde.' : ''),
      });
    } catch (err) {
      setRenewing(null);
      setError(errorMessage(err));
    } finally {
      setSavingTrial(false);
    }
  };

  // Módulo de mesas y comandas: lo activa o lo quita el superadmin (no borra datos)
  const handleToggleTables = async (business) => {
    const enable = !business.tablesEnabled;
    const message = enable
      ? `¿Activar el módulo de mesas para "${business.name}"? Va a aparecer el menú Mesas para sus usuarios.`
      : `¿Quitar el módulo de mesas a "${business.name}"? Se oculta el menú Mesas; las mesas y su historial se conservan.`;
    if (!(await dialog.confirm({ message, confirmLabel: enable ? 'Activar mesas' : 'Quitar mesas', danger: !enable })))
      return;
    setError('');
    try {
      await setBusinessModules(business.id, { tables: enable });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleStartClosure = async (business) => {
    const typed = await dialog.prompt({
      title: 'Dar de baja',
      message:
        `Vas a dar de baja "${business.name}".\n\n` +
        `Desde ahora solo su administrador podrá ingresar, para exportar sus datos. ` +
        `A los 30 días se eliminan todos sus datos (productos, clientes, remitos, usuarios, etc.).`,
      label: 'Para confirmar, escribí el nombre exacto del comercio',
      confirmLabel: 'Dar de baja',
      danger: true,
      validate: (value) => (value.trim() === business.name ? null : 'El nombre no coincide'),
    });
    if (typed === null) return;

    setError('');
    try {
      const { data } = await startBusinessClosure(business.id, typed.trim());
      await dialog.alert({
        title: 'Baja registrada',
        message:
          `Los datos se eliminarán el ${formatDate(data.deleteAt)}.\n` +
          `Avisos por mail enviados: ${data.emailsSent} de ${data.adminCount}.`,
      });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleCancelClosure = async (business) => {
    const message = `¿Cancelar la baja de "${business.name}"? El comercio vuelve a estar activo y no se borra nada.`;
    if (!(await dialog.confirm({ message, confirmLabel: 'Cancelar la baja', cancelLabel: 'Volver' }))) return;

    setError('');
    try {
      await cancelBusinessClosure(business.id);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleReinvite = async (business) => {
    const admin = business.admins[0];
    if (!admin) return;
    const message =
      `Se anulará la contraseña actual de ${admin.email} y se generará un link nuevo ` +
      `para que elija una (se le enviará también por mail). Sus sesiones abiertas se cerrarán. ¿Continuar?`;
    if (!(await dialog.confirm({ message, confirmLabel: 'Generar link nuevo', danger: true }))) return;

    setError('');
    try {
      const { data } = await reinviteBusinessAdmin(business.id, admin.id);
      setInvite({
        title: `Link nuevo para ${data.user.email} (${business.name})`,
        url: data.inviteUrl,
        expires: data.inviteExpiresAt,
        email: data.user.email,
        emailSent: data.emailSent === true,
      });
      setCopied(false);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const handleResetDemo = async (business) => {
    const message = `Se borrarán todos los datos de "${business.name}" y se cargarán los datos de ejemplo. ¿Continuar?`;
    if (!(await dialog.confirm({ message, confirmLabel: 'Reiniciar demo', danger: true }))) return;

    setError('');
    try {
      await resetDemoBusiness(business.id);
      await dialog.alert('Demo reiniciada con datos de ejemplo.');
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const copyInvite = async () => {
    try {
      await navigator.clipboard.writeText(invite.url);
      setCopied(true);
    } catch {
      setError('No se pudo copiar automáticamente. Seleccioná el link y copialo a mano.');
    }
  };

  const whatsappUrl = invite
    ? `https://wa.me/?text=${encodeURIComponent(
        `¡Hola! Te invito a probar el sistema. Activá tu cuenta y elegí tu contraseña desde este link ` +
          `(vence el ${formatDate(invite.expires)}): ${invite.url}`,
      )}`
    : '#';

  const alerts = trialAlerts(businesses);

  return (
    <div className="platform-page">
      <header className="platform-header">
        <h1>Plataforma · Comercios</h1>
        <button type="button" onClick={handleLogout}>
          Cerrar sesión
        </button>
      </header>

      {error && <p className="auth-error">{error}</p>}

      {(alerts.soon.length > 0 || alerts.expired.length > 0) && (
        <section className="trial-alert" role="status">
          <strong>Pruebas gratis</strong>
          <ul>
            {alerts.soon.map((business) => (
              <li key={business.id}>
                <span>
                  <b>{business.name}</b> vence {whenLeft(business.trialEndsAt)} ({formatDate(business.trialEndsAt)})
                </span>
                <button type="button" onClick={() => setRenewing(business)}>
                  Renovar
                </button>
              </li>
            ))}
            {alerts.expired.map((business) => (
              <li key={business.id}>
                <span>
                  <b>{business.name}</b> venció el {formatDate(business.trialEndsAt)} y está suspendido
                </span>
                <button type="button" onClick={() => setRenewing(business)}>
                  Renovar
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {renewing && <TrialDialog business={renewing} saving={savingTrial} onClose={handleRenewClosed} />}

      {invite && (
        <section className="invite-box">
          <strong>{invite.title}</strong>
          <span className={`invite-mail ${invite.emailSent ? 'invite-mail-ok' : 'invite-mail-warn'}`} role="status">
            {invite.emailSent
              ? `Se envió el mail con la invitación a ${invite.email}.`
              : `No se pudo enviar el mail a ${invite.email}. Pasale el link por otro medio.`}
          </span>
          <span>Se muestra una sola vez: copialo ahora. Vence el {formatDate(invite.expires)}.</span>
          <input type="text" readOnly value={invite.url} onFocus={(e) => e.target.select()} />
          <div className="platform-actions">
            <button type="button" onClick={copyInvite}>
              {copied ? '¡Copiado!' : 'Copiar link'}
            </button>
            <a href={whatsappUrl} target="_blank" rel="noreferrer">
              Compartir por WhatsApp
            </a>
            <button type="button" onClick={() => setInvite(null)}>
              Cerrar
            </button>
          </div>
        </section>
      )}

      <section>
        <h2>Nuevo comercio</h2>
        <form className="platform-form" onSubmit={handleCreate}>
          <div className="field">
            <label htmlFor="pf-name">Nombre del comercio</label>
            <input id="pf-name" required value={form.name} onChange={setField('name')} />
          </div>
          <div className="field">
            <label htmlFor="pf-admin-name">Nombre del administrador</label>
            <input id="pf-admin-name" required value={form.adminName} onChange={setField('adminName')} />
          </div>
          <div className="field">
            <label htmlFor="pf-admin-email">Email del administrador</label>
            <input
              id="pf-admin-email"
              type="email"
              required
              value={form.adminEmail}
              onChange={setField('adminEmail')}
            />
          </div>
          <div className="field">
            <label htmlFor="pf-type">Tipo</label>
            <select id="pf-type" value={form.type} onChange={setField('type')}>
              <option value="client">Cliente</option>
              <option value="demo">Demo</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="pf-trial">Días de prueba (opcional)</label>
            <input
              id="pf-trial"
              type="number"
              min="1"
              max="365"
              value={form.trialDays}
              onChange={setField('trialDays')}
            />
          </div>
          <button type="submit" disabled={submitting}>
            {submitting ? 'Creando…' : 'Crear y enviar invitación'}
          </button>
        </form>
      </section>

      <section>
        <h2>Comercios ({businesses.length})</h2>
        {loading ? (
          <p>Cargando…</p>
        ) : (
          <div className="platform-table-wrap">
            <table className="platform-table">
              <thead>
                <tr>
                  <th>Comercio</th>
                  <th>Tipo</th>
                  <th>Estado</th>
                  <th>Administrador</th>
                  <th>Último ingreso</th>
                  <th>Alta</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {businesses.map((business) => {
                  const admin = business.admins[0];
                  const inviteExpired = admin?.inviteExpiresAt && new Date(admin.inviteExpiresAt) < new Date();
                  const isClosing = business.status === 'closing';
                  return (
                    <tr key={business.id}>
                      <td>
                        {business.name}
                        <br />
                        <small>{business.userCount} usuario(s)</small>
                      </td>
                      <td>{business.type === 'demo' ? 'Demo' : 'Cliente'}</td>
                      <td>
                        <span className={`platform-badge ${STATUS_CLASSES[business.status] || 'platform-badge-off'}`}>
                          {STATUS_LABELS[business.status] || business.status}
                        </span>
                        {business.tablesEnabled && (
                          <>
                            <br />
                            <small>Módulo: mesas</small>
                          </>
                        )}
                        {business.status === 'suspended' && business.suspendedReason === TRIAL_EXPIRED && (
                          <>
                            <br />
                            <small>Venció la prueba</small>
                          </>
                        )}
                        {isClosing && business.deleteAt && (
                          <>
                            <br />
                            <small>Se elimina el {formatDate(business.deleteAt)}</small>
                          </>
                        )}
                        {business.trialEndsAt && (
                          <>
                            <br />
                            <small>
                              {new Date(business.trialEndsAt) <= new Date() ? 'Prueba vencida el' : 'Prueba hasta'}{' '}
                              {formatDate(business.trialEndsAt)}
                            </small>
                          </>
                        )}
                      </td>
                      <td>
                        {admin ? (
                          <>
                            {admin.name}
                            <br />
                            <small>{admin.email}</small>
                            {admin.pendingActivation && (
                              <>
                                <br />
                                <span className="platform-badge platform-badge-warn">
                                  {inviteExpired ? 'Invitación vencida' : 'Pendiente de activar'}
                                </span>
                              </>
                            )}
                          </>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td>{formatDate(admin?.lastLoginAt, true)}</td>
                      <td>{formatDate(business.createdAt)}</td>
                      <td>
                        <div className="platform-actions">
                          {!isClosing && (
                            <button type="button" onClick={() => handleToggleStatus(business)}>
                              {business.status === 'active' ? 'Suspender' : 'Reactivar'}
                            </button>
                          )}
                          {business.type === 'client' && !isClosing && (
                            <button type="button" onClick={() => setRenewing(business)}>
                              {business.trialEndsAt ? 'Renovar prueba' : 'Poner vencimiento'}
                            </button>
                          )}
                          {!isClosing && (
                            <button type="button" onClick={() => handleToggleTables(business)}>
                              {business.tablesEnabled ? 'Quitar mesas' : 'Activar mesas'}
                            </button>
                          )}
                          {admin && (
                            <button type="button" onClick={() => handleReinvite(business)}>
                              Link nuevo
                            </button>
                          )}
                          {business.type === 'demo' && (
                            <button type="button" onClick={() => handleResetDemo(business)}>
                              Reiniciar demo
                            </button>
                          )}
                          {business.type === 'client' && !isClosing && (
                            <button type="button" onClick={() => handleStartClosure(business)}>
                              Dar de baja
                            </button>
                          )}
                          {isClosing && (
                            <button type="button" onClick={() => handleCancelClosure(business)}>
                              Cancelar baja
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <AuditLog />
    </div>
  );
}
