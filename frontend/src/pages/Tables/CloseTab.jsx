import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import * as tablesApi from '../../api/tables.api.js';
import { approveOrder } from '../../api/orders.api.js';
import ApprovalDialog from '../Orders/ApprovalDialog.jsx';
import SearchSelect from '../../components/common/SearchSelect.jsx';
import FormMessage from '../../components/common/FormMessage.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { serverMessage } from '../../utils/serverErrors.js';
import { newRequestId } from '../../utils/requestId.js';
import { money } from '../../utils/reportFormat.js';
import { equalParts, formatQty, groupWithExtras, scaleParts } from './tableUtils.js';

const MODES = [
  ['single', 'Una sola cuenta'],
  ['equal', 'En partes iguales'],
  ['items', 'Por lo que pidió cada uno'],
];

const round2 = (n) => Math.round(n * 100) / 100;

// Cobrar una mesa: entera, en partes iguales o por ítems. Cada parte tiene su forma de pago y su
// propina. Se genera un solo remito con todo lo pedido.
// Descuento (en % y/o en pesos) sobre el total, como en Remitos: administrador y editor lo aplican
// directo; el operador necesita que un administrador o editor lo autorice con su email y contraseña.
export default function CloseTab({ tab, payments, customers, onCancel, onDone }) {
  const { role } = useAuth();
  const needsApproval = role !== 'admin' && role !== 'editor';
  const msg = useMessage();
  const activePayments = payments.filter((p) => p.active !== false);
  // Por ítems se reparte cada plato con sus adicionales
  const groups = groupWithExtras(tab.items.filter((i) => i.status === 'active'));
  const [mode, setMode] = useState('single');
  const [count, setCount] = useState(2);
  const [assign, setAssign] = useState(() => Object.fromEntries(groups.map((g) => [g.item.id, 0])));
  const [parts, setParts] = useState(() =>
    Array.from({ length: 20 }, () => ({ paymentId: activePayments[0]?.id || '', tip: '' })),
  );
  const [customerId, setCustomerId] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(null);
  const [discountPercent, setDiscountPercent] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [approval, setApproval] = useState(null); // { notice } mientras se pide la autorización
  const requestIdRef = useRef(newRequestId());
  const approvalTokenRef = useRef(null);

  // Mismo cálculo que el servidor (services/table.service.js → discountedTotal)
  const percent = Number(discountPercent) || 0;
  const amountOff = round2(Number(discountAmount) || 0);
  const totalDiscount = round2(tab.total * (percent / 100) + amountOff);
  const discountError =
    percent < 0 || percent > 100
      ? 'El porcentaje de descuento debe estar entre 0 y 100.'
      : amountOff < 0
        ? 'El descuento por monto no puede ser negativo.'
        : totalDiscount > tab.total + 0.005
          ? 'El descuento no puede ser mayor al total de la mesa.'
          : '';
  const total = discountError ? tab.total : round2(tab.total - totalDiscount);
  const hasDiscount = !discountError && totalDiscount > 0;

  // Si cambia el descuento, la autorización anterior ya no sirve
  const changeDiscount = (setter) => (e) => {
    approvalTokenRef.current = null;
    setter(e.target.value);
  };

  const n = mode === 'single' ? 1 : Math.min(Math.max(Number(count) || 2, 2), 20);
  const amounts =
    mode === 'single'
      ? [total]
      : mode === 'equal'
        ? equalParts(total, n)
        : scaleParts(
            Array.from({ length: n }, (_, part) =>
              round2(
                groups.filter((g) => Math.min(assign[g.item.id] || 0, n - 1) === part).reduce((s, g) => s + g.total, 0),
              ),
            ),
            total,
          );

  const setPart = (index, field, value) => setParts(parts.map((p, i) => (i === index ? { ...p, [field]: value } : p)));

  const tips = amounts.reduce((s, _, i) => s + (Number(parts[i].tip) || 0), 0);

  const charge = async () => {
    const rows = amounts
      .map((amount, i) => ({ paymentId: parts[i].paymentId, amount, tip: Number(parts[i].tip) || 0 }))
      .filter((p) => p.amount > 0 || p.tip > 0);
    if (discountError) return msg.error(discountError);
    if (!rows.length) return msg.error('Con este descuento no queda nada para cobrar.');
    if (rows.some((p) => !p.paymentId)) return msg.error('Elegí la forma de pago de cada parte.');
    if (rows.some((p) => p.tip < 0)) return msg.error('La propina no puede ser negativa.');
    // El operador pide la autorización antes de cobrar con descuento
    if (needsApproval && hasDiscount && !approvalTokenRef.current) {
      setApproval({ notice: null });
      return undefined;
    }
    setSaving(true);
    try {
      const { data } = await tablesApi.closeTab(tab.id, {
        customerId: customerId || null,
        parts: rows,
        requestId: requestIdRef.current,
        discountPercent: hasDiscount ? percent : 0,
        discountAmount: hasDiscount ? amountOff : 0,
        ...(approvalTokenRef.current ? { approvalToken: approvalTokenRef.current } : {}),
      });
      setDone({ orderId: data.orderId, total });
    } catch (err) {
      // La autorización falta, venció o el descuento cambió: se pide de nuevo
      if (err.response?.data?.code === 'APPROVAL_REQUIRED') {
        approvalTokenRef.current = null;
        setApproval({ notice: err.response.data.message });
      } else {
        msg.error(serverMessage(err, 'No se pudo cobrar la mesa.'));
      }
    } finally {
      setSaving(false);
    }
    return undefined;
  };

  const submit = (e) => {
    e.preventDefault();
    charge();
  };

  const handleApprove = async (email, password) => {
    const { data } = await approveOrder({
      email,
      password,
      requestId: requestIdRef.current,
      discountPercent: percent,
      discountAmount: amountOff,
      items: [],
    });
    approvalTokenRef.current = data.approvalToken;
    setApproval(null);
    await charge();
  };

  if (done) {
    return (
      <section className="tab-panel">
        <h2>Mesa {tab.table?.name} cobrada</h2>
        <p>Se generó el remito por {money(done.total)}.</p>
        <div className="inline-edit-actions">
          <Link to={`/orders/${done.orderId}/print`}>
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
    <>
      <form className="tab-panel" onSubmit={submit}>
        <header className="tab-panel-header">
          <h2>
            Cobrar mesa {tab.table?.name} · {money(total)}
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

        <div className="close-discount">
          <div className="field">
            <label htmlFor="close-discount-percent">Descuento en %</label>
            <input
              id="close-discount-percent"
              type="number"
              min="0"
              max="100"
              step="0.01"
              placeholder="0"
              value={discountPercent}
              onChange={changeDiscount(setDiscountPercent)}
            />
          </div>
          <div className="field">
            <label htmlFor="close-discount-amount">Descuento por monto ($)</label>
            <input
              id="close-discount-amount"
              type="number"
              min="0"
              step="0.01"
              placeholder="0"
              value={discountAmount}
              onChange={changeDiscount(setDiscountAmount)}
            />
          </div>
        </div>
        {needsApproval && (
          <p className="report-note">
            Si hacés un descuento, lo tiene que autorizar un administrador o editor con su email y contraseña.
          </p>
        )}
        {discountError && <p className="error">{discountError}</p>}

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
            {groups.map(({ item, extras, total }) => (
              <li key={item.id}>
                <span>
                  {formatQty(item.quantity)} × {item.name}
                  {extras.length > 0 && <small> · con {extras.map((x) => x.name).join(', ')}</small>} · {money(total)}
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
          {hasDiscount && (
            <span>
              Subtotal: {money(tab.total)} · Descuento: −{money(totalDiscount)} ·{' '}
            </span>
          )}
          <strong>Total de la cuenta: {money(total)}</strong>
          {tips > 0 && <span> · Propinas: {money(tips)} (aparte de la venta)</span>}
        </p>
        <div className="inline-edit-actions">
          <button type="submit" disabled={saving || !activePayments.length || Boolean(discountError)}>
            {saving ? 'Cobrando…' : 'Cobrar y generar remito'}
          </button>
        </div>
        {!activePayments.length && <p className="error">No hay formas de pago activas: cargalas en Formas de pago.</p>}
        <FormMessage message={msg.at()} onClose={msg.clear} />
      </form>
      {approval && (
        <ApprovalDialog
          summary={{ discountPercent: percent, discountAmount: amountOff, prices: [] }}
          notice={approval.notice}
          defaultNotice="Esta mesa tiene un descuento."
          approveLabel="Autorizar y cobrar"
          cancelLabel="Volver a la mesa"
          onApprove={handleApprove}
          onCancel={() => setApproval(null)}
        />
      )}
    </>
  );
}
