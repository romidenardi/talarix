import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import * as tablesApi from '../../api/tables.api.js';
import SearchSelect from '../../components/common/SearchSelect.jsx';
import FormMessage from '../../components/common/FormMessage.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { serverMessage } from '../../utils/serverErrors.js';
import { newRequestId } from '../../utils/requestId.js';
import { money } from '../../utils/reportFormat.js';
import { equalParts, lineTotal, formatQty } from './tableUtils.js';

const MODES = [
  ['single', 'Una sola cuenta'],
  ['equal', 'En partes iguales'],
  ['items', 'Por lo que pidió cada uno'],
];

const round2 = (n) => Math.round(n * 100) / 100;

// Cobrar una mesa: entera, en partes iguales o por ítems. Cada parte tiene su forma de pago y su
// propina. Se genera un solo remito con todo lo pedido.
export default function CloseTab({ tab, payments, customers, onCancel, onDone }) {
  const msg = useMessage();
  const activePayments = payments.filter((p) => p.active !== false);
  const items = tab.items.filter((i) => i.status === 'active');
  const [mode, setMode] = useState('single');
  const [count, setCount] = useState(2);
  const [assign, setAssign] = useState(() => Object.fromEntries(items.map((i) => [i.id, 0])));
  const [parts, setParts] = useState(() =>
    Array.from({ length: 20 }, () => ({ paymentId: activePayments[0]?.id || '', tip: '' })),
  );
  const [customerId, setCustomerId] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);
  const requestIdRef = useRef(newRequestId());

  const n = mode === 'single' ? 1 : Math.min(Math.max(Number(count) || 2, 2), 20);
  const amounts =
    mode === 'single'
      ? [tab.total]
      : mode === 'equal'
        ? equalParts(tab.total, n)
        : Array.from({ length: n }, (_, part) =>
            round2(items.filter((i) => (assign[i.id] || 0) === part).reduce((s, i) => s + lineTotal(i), 0)),
          );

  const setPart = (index, field, value) => setParts(parts.map((p, i) => (i === index ? { ...p, [field]: value } : p)));

  const tips = amounts.reduce((s, _, i) => s + (Number(parts[i].tip) || 0), 0);

  const submit = async (e) => {
    e.preventDefault();
    const rows = amounts
      .map((amount, i) => ({ paymentId: parts[i].paymentId, amount, tip: Number(parts[i].tip) || 0 }))
      .filter((p) => p.amount > 0 || p.tip > 0);
    if (rows.some((p) => !p.paymentId)) return msg.error('Elegí la forma de pago de cada parte');
    if (rows.some((p) => p.tip < 0)) return msg.error('La propina no puede ser negativa');
    setSaving(true);
    try {
      const { data } = await tablesApi.closeTab(tab.id, {
        customerId: customerId || null,
        parts: rows,
        requestId: requestIdRef.current,
      });
      setDone(data.orderId);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo cobrar la mesa'));
    } finally {
      setSaving(false);
    }
    return undefined;
  };

  if (done) {
    return (
      <section className="tab-panel">
        <h2>Mesa {tab.table?.name} cobrada</h2>
        <p>Se generó el remito por {money(tab.total)}.</p>
        <div className="inline-edit-actions">
          <Link to={`/orders/${done}/print`}>
            <button type="button">Ver remito</button>
          </Link>
          <button type="button" onClick={onDone}>
            Listo
          </button>
        </div>
      </section>
    );
  }

  const customerOptions = customers
    .filter((c) => !c.anonymizedAt)
    .map((c) => ({
      value: c.id,
      label: c.businessName || `${c.firstName || ''} ${c.lastName || ''}`.trim(),
      detail: c.cuit ? `CUIT ${c.cuit}` : c.fiscalCondition,
      keywords: [c.cuit],
    }));

  return (
    <form className="tab-panel" onSubmit={submit}>
      <header className="tab-panel-header">
        <h2>
          Cobrar mesa {tab.table?.name} · {money(tab.total)}
        </h2>
        <button type="button" onClick={onCancel}>
          Volver
        </button>
      </header>

      <div className="field">
        <label htmlFor="close-customer">Cliente (opcional: si no se elige, Consumidor Final)</label>
        <SearchSelect
          id="close-customer"
          title="Buscar cliente"
          placeholder="Consumidor Final"
          value={customerId}
          onChange={setCustomerId}
          options={customerOptions}
        />
      </div>

      <div className="report-tabs" role="tablist">
        {MODES.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mode === key}
            className={mode === key ? 'active' : ''}
            onClick={() => setMode(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {mode !== 'single' && (
        <div className="field">
          <label htmlFor="close-count">Partes</label>
          <input
            id="close-count"
            type="number"
            min="2"
            max="20"
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </div>
      )}

      {mode === 'items' && (
        <ul className="tab-items">
          {items.map((item) => (
            <li key={item.id}>
              <span>
                {formatQty(item.quantity)} × {item.name} · {money(lineTotal(item))}
              </span>
              <select
                aria-label={`Parte de ${item.name}`}
                value={Math.min(assign[item.id] || 0, n - 1)}
                onChange={(e) => setAssign({ ...assign, [item.id]: Number(e.target.value) })}
              >
                {Array.from({ length: n }, (_, part) => (
                  <option key={part} value={part}>
                    Parte {part + 1}
                  </option>
                ))}
              </select>
            </li>
          ))}
        </ul>
      )}

      <div className="close-parts">
        {amounts.map((amount, index) => (
          <div key={index} className="close-part">
            <strong>
              {mode === 'single' ? 'Pago' : `Parte ${index + 1}`}: {money(amount)}
            </strong>
            <div className="field">
              <label htmlFor={`close-payment-${index}`}>Forma de pago</label>
              <select
                id={`close-payment-${index}`}
                value={parts[index].paymentId}
                onChange={(e) => setPart(index, 'paymentId', e.target.value)}
              >
                {activePayments.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={`close-tip-${index}`}>Propina</label>
              <input
                id={`close-tip-${index}`}
                type="number"
                min="0"
                step="0.01"
                placeholder="0"
                value={parts[index].tip}
                onChange={(e) => setPart(index, 'tip', e.target.value)}
              />
            </div>
          </div>
        ))}
      </div>

      <p className="tab-total">
        <strong>Total de la cuenta: {money(tab.total)}</strong>
        {tips > 0 && <span> · Propinas: {money(tips)} (aparte de la venta)</span>}
      </p>
      <div className="inline-edit-actions">
        <button type="submit" disabled={saving || !activePayments.length}>
          {saving ? 'Cobrando…' : 'Cobrar y generar remito'}
        </button>
      </div>
      {!activePayments.length && <p className="error">No hay formas de pago activas: cargalas en Formas de pago.</p>}
      <FormMessage message={msg.at()} onClose={msg.clear} />
    </form>
  );
}
