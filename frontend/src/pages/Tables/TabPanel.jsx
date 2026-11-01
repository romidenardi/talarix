import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useDialog } from '../../context/DialogContext.jsx';
import * as tablesApi from '../../api/tables.api.js';
import SearchSelect from '../../components/common/SearchSelect.jsx';
import FormMessage from '../../components/common/FormMessage.jsx';
import Spinner from '../../components/common/Spinner.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { serverMessage } from '../../utils/serverErrors.js';
import { newRequestId } from '../../utils/requestId.js';
import { money } from '../../utils/reportFormat.js';
import {
  STATUS_LABELS,
  lineTotal,
  groupWithExtras,
  itemClass,
  timeLabel,
  formatQty,
  readPrintPref,
  savePrintPref,
  printTicket,
} from './tableUtils.js';
import CloseTab from './CloseTab.jsx';

const EMPTY_PICK = { productId: '', quantity: '1', note: '', extraIds: [] };

// Una mesa: abrirla, ver lo pedido por comanda, mandar platos del menú (con sus adicionales) a la
// cocina, anular platos, pedir la cuenta y cobrar.
export default function TabPanel({ table, menu, payments, customers, onChanged, onClose }) {
  const { role } = useAuth();
  const dialog = useDialog();
  const isManager = role === 'admin' || role === 'editor';
  const canCharge = isManager || role === 'operador';
  const msg = useMessage();
  const [tab, setTab] = useState(null);
  const [loading, setLoading] = useState(Boolean(table.tab));
  const [guests, setGuests] = useState('');
  const [draft, setDraft] = useState([]);
  const [pick, setPick] = useState(EMPTY_PICK);
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [printOnSend, setPrintOnSend] = useState(readPrintPref);
  const requestIdRef = useRef(newRequestId());

  const load = async (tabId) => {
    try {
      const { data } = await tablesApi.getTab(tabId);
      setTab(data);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo cargar la mesa'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (table.tab) load(table.tab.id);
  }, [table.tab?.id]);

  const run = async (action, fallback) => {
    try {
      const { data } = await action();
      if (data?.id && data.items) setTab(data);
      await onChanged();
      return true;
    } catch (err) {
      msg.error(serverMessage(err, fallback));
      return false;
    }
  };

  const open = () => run(() => tablesApi.openTab(table.id, guests || null), 'No se pudo abrir la mesa');

  // Se piden solo los platos activos del menú (Mesas → Menú), con el precio promo si tienen
  const priceOf = (p) => Number(p.promoPrice ?? p.price) || 0;
  const dishOptions = menu.dishes
    .filter((d) => d.active !== false)
    .map((d) => ({
      value: d.id,
      label: d.name,
      detail: [d.internalCode, money(priceOf(d))].filter(Boolean).join(' · '),
      keywords: [d.internalCode],
    }));
  const dishById = new Map(menu.dishes.map((d) => [d.id, d]));
  const extraById = new Map(menu.extras.map((x) => [x.id, x]));
  const extrasFor = (dish) =>
    (dish?.extraIds || []).map((id) => extraById.get(id)).filter((x) => x && x.active !== false);
  const pickedDish = dishById.get(pick.productId);
  const pickExtras = extrasFor(pickedDish);

  const toggleExtra = (id) =>
    setPick({
      ...pick,
      extraIds: pick.extraIds.includes(id) ? pick.extraIds.filter((x) => x !== id) : [...pick.extraIds, id],
    });

  // El plato elegido arriba, listo para sumar a la lista (o null con el motivo en pantalla)
  const pickedItem = () => {
    const dish = pickedDish;
    const quantity = Number(pick.quantity);
    if (!dish) return msg.error('Elegí el plato', 'draft');
    if (!(quantity > 0) || !Number.isInteger(quantity)) {
      return msg.error('La cantidad tiene que ser un número entero mayor a 0', 'draft');
    }
    const extras = pickExtras.filter((x) => pick.extraIds.includes(x.id));
    return { key: `${Date.now()}-${Math.random()}`, dish, extras, quantity, note: pick.note.trim() };
  };

  const addToDraft = () => {
    const item = pickedItem();
    if (!item) return;
    setDraft([...draft, item]);
    setPick(EMPTY_PICK);
    msg.clear();
  };

  const draftTotal = (d) => d.quantity * (priceOf(d.dish) + d.extras.reduce((s, x) => s + priceOf(x), 0));

  const send = async () => {
    if (sending) return;
    // Si quedó un plato elegido sin tocar "Agregar", se manda también
    let items = draft;
    if (pick.productId) {
      const item = pickedItem();
      if (!item) return;
      items = [...draft, item];
    }
    if (!items.length) {
      msg.error('Elegí un plato y tocá Agregar', 'draft');
      return;
    }
    setSending(true);
    try {
      const { data } = await tablesApi.sendTicket(
        tab.id,
        items.map((d) => ({
          productId: d.dish.id,
          quantity: d.quantity,
          note: d.note || null,
          extraIds: d.extras.map((x) => x.id),
        })),
        requestIdRef.current,
      );
      requestIdRef.current = newRequestId();
      setDraft([]);
      setPick(EMPTY_PICK);
      if (printOnSend) printTicket(data.ticket.id);
      await load(tab.id);
      await onChanged();
      msg.success(`Comanda ${data.ticket.number} enviada a la cocina`, 'send');
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo mandar la comanda'), 'send');
    } finally {
      setSending(false);
    }
  };

  const cancelItem = async (item, extras = []) => {
    const reason = await dialog.prompt({
      title: item.parentItemId ? 'Anular adicional' : 'Anular plato',
      message: `${formatQty(item.quantity)} × ${item.name}.${extras.length ? ' Se anulan también sus adicionales.' : ''}`,
      label: 'Motivo (opcional)',
      confirmLabel: 'Anular',
      danger: true,
    });
    if (reason === null) return;
    await run(() => tablesApi.cancelTabItem(tab.id, item.id, reason), 'No se pudo anular el plato');
  };

  const cancelWholeTab = async () => {
    const reason = await dialog.prompt({
      title: `Anular mesa ${table.name}`,
      message: 'Se anulan todos los platos. No se genera ningún remito.',
      label: 'Motivo (opcional)',
      confirmLabel: 'Anular mesa',
      danger: true,
    });
    if (reason === null) return;
    if (await run(() => tablesApi.cancelTab(tab.id, reason), 'No se pudo anular la mesa')) onClose();
  };

  if (!table.tab && !tab) {
    return (
      <section className="tab-panel">
        <header className="tab-panel-header">
          <h2>Mesa {table.name}</h2>
          <button type="button" onClick={onClose}>
            Cerrar
          </button>
        </header>
        <div className="inline-edit-form">
          <div className="field">
            <label htmlFor="tab-guests">Personas (opcional)</label>
            <input
              id="tab-guests"
              type="number"
              min="1"
              max="99"
              value={guests}
              onChange={(e) => setGuests(e.target.value)}
            />
          </div>
          <div className="inline-edit-actions">
            <button type="button" className="btn-primary" onClick={open}>
              Abrir mesa
            </button>
          </div>
        </div>
        <FormMessage message={msg.at()} onClose={msg.clear} />
      </section>
    );
  }

  if (loading || !tab) return <Spinner label="Cargando mesa..." />;

  const isOpen = tab.status === 'open' || tab.status === 'billing';
  const byTicket = (tab.tickets || []).map((ticket) => ({
    ticket,
    groups: groupWithExtras(tab.items.filter((i) => i.ticketId === ticket.id)),
  }));

  if (closing) {
    return (
      <CloseTab
        tab={tab}
        payments={payments}
        customers={customers}
        onCancel={() => setClosing(false)}
        onDone={async () => {
          setClosing(false);
          await onChanged();
          onClose();
        }}
      />
    );
  }

  return (
    <section className="tab-panel">
      <header className="tab-panel-header">
        <h2>
          Mesa {table.name} · {STATUS_LABELS[tab.status]}
        </h2>
        <button type="button" onClick={onClose}>
          Cerrar
        </button>
      </header>
      <p className="report-note">
        Abierta a las {timeLabel(tab.openedAt)}
        {tab.waiterName && ` por ${tab.waiterName}`}
        {tab.guests ? ` · ${tab.guests} ${tab.guests === 1 ? 'persona' : 'personas'}` : ''}
      </p>

      {byTicket.length === 0 && <p className="report-note">Todavía no se pidió nada.</p>}
      {byTicket.map(({ ticket, groups }) => (
        <div key={ticket.id} className="tab-ticket">
          <div className="tab-ticket-header">
            <strong>Comanda {ticket.number}</strong>
            <span>
              {timeLabel(ticket.createdAt)} · {ticket.status === 'ready' ? 'Lista' : 'En cocina'}
            </span>
            <button type="button" onClick={() => printTicket(ticket.id)}>
              Imprimir
            </button>
          </div>
          <ul className="tab-items">
            {groups.flatMap(({ item, extras }) =>
              [item, ...extras].map((row) => (
                <li key={row.id} className={itemClass(row)}>
                  <span>
                    {row === item ? `${formatQty(row.quantity)} × ${row.name}` : `+ ${row.name}`}
                    {row.note && <small> · {row.note}</small>}
                    {row.status === 'cancelled' && (
                      <small> · Anulado{row.cancelReason ? `: ${row.cancelReason}` : ''}</small>
                    )}
                  </span>
                  <span>{money(lineTotal(row))}</span>
                  {isOpen && isManager && row.status === 'active' && (
                    <button
                      type="button"
                      onClick={() => cancelItem(row, row === item ? extras.filter((x) => x.status === 'active') : [])}
                    >
                      Anular
                    </button>
                  )}
                </li>
              )),
            )}
          </ul>
        </div>
      ))}

      <p className="tab-total">
        <strong>Total: {money(tab.total)}</strong>
      </p>

      {isOpen && (
        <div className="tab-draft">
          <h3>Pedir</h3>
          <div className="tab-draft-row">
            <div className="field">
              <label htmlFor="tab-product">Plato</label>
              <SearchSelect
                id="tab-product"
                title="Buscar plato"
                placeholder="Elegí un plato..."
                searchPlaceholder="Nombre o código..."
                value={pick.productId}
                onChange={(value) => setPick({ ...pick, productId: value, extraIds: [] })}
                options={dishOptions}
              />
            </div>
            <div className="field">
              <label htmlFor="tab-qty">Cantidad</label>
              <input
                id="tab-qty"
                type="number"
                min="1"
                step="1"
                value={pick.quantity}
                onChange={(e) => setPick({ ...pick, quantity: e.target.value })}
              />
            </div>
            <div className="field">
              <label htmlFor="tab-note">Nota para la cocina</label>
              <input
                id="tab-note"
                placeholder="Ej: sin cebolla"
                maxLength={255}
                value={pick.note}
                onChange={(e) => setPick({ ...pick, note: e.target.value })}
              />
            </div>
            <button type="button" onClick={addToDraft}>
              Agregar
            </button>
          </div>
          {pickExtras.length > 0 && (
            <fieldset className="tab-extras">
              <legend>Adicionales (opcional)</legend>
              {pickExtras.map((x) => (
                <label key={x.id} htmlFor={`tab-extra-${x.id}`}>
                  <input
                    id={`tab-extra-${x.id}`}
                    type="checkbox"
                    checked={pick.extraIds.includes(x.id)}
                    onChange={() => toggleExtra(x.id)}
                  />{' '}
                  {x.name} <small>+{money(priceOf(x))}</small>
                </label>
              ))}
            </fieldset>
          )}
          {menu.dishes.length === 0 && (
            <p className="report-note">
              Todavía no hay platos en el menú.{' '}
              {isManager ? 'Cargalos en la pestaña Menú.' : 'Pedile al administrador que los cargue.'}
            </p>
          )}
          <FormMessage message={msg.at('draft')} onClose={msg.clear} />

          {draft.length > 0 && (
            <ul className="tab-items">
              {draft.map((d) => (
                <li key={d.key}>
                  <span>
                    {d.quantity} × {d.dish.name}
                    {d.extras.length > 0 && <small> · con {d.extras.map((x) => x.name).join(', ')}</small>}
                    {d.note && <small> · {d.note}</small>}
                  </span>
                  <span>{money(draftTotal(d))}</span>
                  <button type="button" onClick={() => setDraft(draft.filter((x) => x.key !== d.key))}>
                    Quitar
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="inline-edit-actions">
            <button type="button" className="btn-primary" onClick={send} disabled={sending}>
              {sending ? 'Mandando…' : 'Mandar a cocina'}
            </button>
            <label htmlFor="tab-print">
              <input
                id="tab-print"
                type="checkbox"
                checked={printOnSend}
                onChange={(e) => {
                  setPrintOnSend(e.target.checked);
                  savePrintPref(e.target.checked);
                }}
              />{' '}
              Imprimir la comanda al mandarla
            </label>
          </div>
          <FormMessage message={msg.at('send')} onClose={msg.clear} />
        </div>
      )}

      {isOpen && (
        <div className="inline-edit-actions tab-actions">
          {tab.status === 'open' && (
            <button
              type="button"
              onClick={() => run(() => tablesApi.requestBill(tab.id), 'No se pudo pedir la cuenta')}
            >
              Pedir la cuenta
            </button>
          )}
          {canCharge && (
            <button type="button" className="btn-primary" onClick={() => setClosing(true)} disabled={!tab.total}>
              Cobrar
            </button>
          )}
          {isManager && (
            <button type="button" className="btn-danger" onClick={cancelWholeTab}>
              Anular mesa
            </button>
          )}
        </div>
      )}
      <FormMessage message={msg.at()} onClose={msg.clear} />
    </section>
  );
}
