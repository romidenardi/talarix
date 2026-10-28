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
import { formatQuantity, quantityStep } from '../../utils/quantity.js';
import { isVariantGroup } from '../../utils/variants.js';
import {
  STATUS_LABELS,
  lineTotal,
  timeLabel,
  formatQty,
  readPrintPref,
  savePrintPref,
  printTicket,
} from './tableUtils.js';
import CloseTab from './CloseTab.jsx';

// Una mesa: abrirla, ver lo pedido por comanda, mandar platos a la cocina, anular platos,
// pedir la cuenta y cobrar.
export default function TabPanel({ table, products, payments, customers, onChanged, onClose }) {
  const { role } = useAuth();
  const dialog = useDialog();
  const isManager = role === 'admin' || role === 'editor';
  const canCharge = isManager || role === 'operador';
  const msg = useMessage();
  const [tab, setTab] = useState(null);
  const [loading, setLoading] = useState(Boolean(table.tab));
  const [guests, setGuests] = useState('');
  const [draft, setDraft] = useState([]);
  const [pick, setPick] = useState({ productId: '', quantity: '1', note: '' });
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

  // Los platos que se pueden pedir: activos, y de un producto con variantes, la variante
  const productOptions = products
    .filter((p) => p.active !== false && !isVariantGroup(p))
    .map((p) => ({
      value: p.id,
      label: p.name,
      detail: [p.isCombo && 'Combo', money(p.price)].filter(Boolean).join(' · '),
      keywords: [p.internalCode, p.barcode],
    }));
  const productById = new Map(products.map((p) => [p.id, p]));

  // El plato elegido arriba, listo para sumar a la lista (o null con el motivo en pantalla)
  const pickedItem = () => {
    const product = productById.get(pick.productId);
    const quantity = Number(pick.quantity);
    if (!product) return msg.error('Elegí el plato', 'draft');
    if (!(quantity > 0)) return msg.error('La cantidad tiene que ser mayor a 0', 'draft');
    if (product.unitType !== 'weight' && !Number.isInteger(quantity)) {
      return msg.error(`${product.name} se pide por unidad`, 'draft');
    }
    return { key: `${Date.now()}-${Math.random()}`, product, quantity, note: pick.note.trim() };
  };

  const addToDraft = () => {
    const item = pickedItem();
    if (!item) return;
    setDraft([...draft, item]);
    setPick({ productId: '', quantity: '1', note: '' });
    msg.clear();
  };

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
        items.map((d) => ({ productId: d.product.id, quantity: d.quantity, note: d.note || null })),
        requestIdRef.current,
      );
      requestIdRef.current = newRequestId();
      setDraft([]);
      setPick({ productId: '', quantity: '1', note: '' });
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

  const cancelItem = async (item) => {
    const reason = await dialog.prompt({
      title: 'Anular plato',
      message: `${formatQty(item.quantity)} × ${item.name}. El stock vuelve.`,
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
      message: 'Se anulan todos los platos y vuelve su stock. No se genera ningún remito.',
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
    items: tab.items.filter((i) => i.ticketId === ticket.id),
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
      {byTicket.map(({ ticket, items }) => (
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
            {items.map((item) => (
              <li key={item.id} className={item.status === 'cancelled' ? 'tab-item-cancelled' : ''}>
                <span>
                  {formatQty(item.quantity)} × {item.name}
                  {item.note && <small> · {item.note}</small>}
                  {item.status === 'cancelled' && (
                    <small> · Anulado{item.cancelReason ? `: ${item.cancelReason}` : ''}</small>
                  )}
                </span>
                <span>{money(lineTotal(item))}</span>
                {isOpen && isManager && item.status === 'active' && (
                  <button type="button" onClick={() => cancelItem(item)}>
                    Anular
                  </button>
                )}
              </li>
            ))}
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
              <label htmlFor="tab-product">Plato o producto</label>
              <SearchSelect
                id="tab-product"
                title="Buscar plato"
                placeholder="Elegí un plato..."
                searchPlaceholder="Nombre o código..."
                value={pick.productId}
                onChange={(value) => setPick({ ...pick, productId: value })}
                options={productOptions}
              />
            </div>
            <div className="field">
              <label htmlFor="tab-qty">Cantidad</label>
              <input
                id="tab-qty"
                type="number"
                min="0"
                step={quantityStep(productById.get(pick.productId)?.unitType || 'unit', 'kg')}
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
          <FormMessage message={msg.at('draft')} onClose={msg.clear} />

          {draft.length > 0 && (
            <ul className="tab-items">
              {draft.map((d) => (
                <li key={d.key}>
                  <span>
                    {formatQuantity(d.quantity, d.product.unitType)} × {d.product.name}
                    {d.note && <small> · {d.note}</small>}
                  </span>
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
