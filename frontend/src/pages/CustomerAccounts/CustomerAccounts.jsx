import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { useDialog } from '../../context/DialogContext.jsx';
import {
  getCustomerBalances,
  getCustomerStatement,
  getCustomerPayments,
  createCustomerPayment,
  cancelCustomerPayment,
  getCustomerInstallments,
  getCustomerOverdue,
  getLateFeeConfig,
  updateLateFeeConfig,
} from '../../api/customerAccounts.api.js';
import { getPayments } from '../../api/payments.api.js';
import Spinner from '../../components/common/Spinner.jsx';
import FormMessage from '../../components/common/FormMessage.jsx';
import DateRangeFilter from '../../components/common/DateRangeFilter.jsx';
import { RequiredMark, RequiredLegend } from '../../components/common/Required.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { serverMessage } from '../../utils/serverErrors.js';
import { money, presetRange, toISODate, downloadCsv } from '../../utils/reportFormat.js';
import { newRequestId } from '../../utils/requestId.js';
import { customerBalanceLabel as balanceLabel } from '../../utils/customerAccounts.js';
import StatementTable from '../SupplierAccounts/StatementTable.jsx';
import { daysLate, lateFee } from '../../utils/accountInstallments.js';

// Cuenta corriente de clientes (el espejo de pages/SupplierAccounts). El saldo de cada cliente es:
// saldo inicial + remitos a cuenta corriente (con su interés) − cobranzas. Cada remito se divide en
// cuotas con vencimiento, y cada cobranza paga cuotas completas. Abajo, la mora por tramo de atraso.
// Recargo por mora: el comercio configura % mensual y días de gracia («Recargo por mora»); cada remito
// guarda los vigentes y sus cuotas vencidas cobran con esos (el saldo inicial, con los vigentes). Se
// suma al cobrar, aparte del saldo, y se puede perdonar. El cálculo es el de
// utils/accountInstallments.js (lateFee), el mismo que hace el servidor.
// Solo administrador y editor.

const formatDate = (value) => new Date(value).toLocaleDateString('es-AR');
// Fecha sin hora (AAAA-MM-DD) → dd/mm/aaaa
const formatKey = (key) => (key ? key.split('-').reverse().join('/') : '—');

// Estado de una cuota, en palabras
const installmentStatus = (inst) => {
  if (inst.paid) return `Pagada${inst.paidAt ? ` el ${formatDate(inst.paidAt)}` : ''}`;
  if (inst.daysLate > 0) return `Vencida hace ${inst.daysLate} ${inst.daysLate === 1 ? 'día' : 'días'}`;
  return 'Por vencer';
};
const installmentLabel = (inst) =>
  `${inst.description}${inst.installmentsCount > 1 ? ` · cuota ${inst.number} de ${inst.installmentsCount}` : ''}`;

// Fecha elegida en el formulario → la que se manda. Hoy: sin fecha (el servidor usa la hora actual,
// así la cobranza queda después de los remitos de hoy). Otro día: al mediodía de Argentina.
const paymentDate = (day) => (day && day !== toISODate(new Date()) ? `${day}T12:00:00-03:00` : undefined);

// Nombre del cliente como lo trae la cobranza
const customerLabel = (c) =>
  c ? c.businessName || [c.firstName, c.lastName].filter(Boolean).join(' ') || 'Cliente sin nombre' : 'este cliente';

// Lo que pagó el cliente en una cobranza: las cuotas más el recargo
const paidTotal = (p) => Math.round((Number(p.amount) + (Number(p.lateFee) || 0)) * 100) / 100;
const round2 = (n) => Math.round(n * 100) / 100;

const emptyPayment = () => ({
  customerId: '',
  date: toISODate(new Date()),
  paymentId: '',
  reference: '',
  notes: '',
});

const CustomerAccounts = () => {
  const msg = useMessage();
  const dialog = useDialog();
  const [balances, setBalances] = useState([]);
  const [paymentMethods, setPaymentMethods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [onlyWithBalance, setOnlyWithBalance] = useState(true);

  const [statementId, setStatementId] = useState(null);
  const [statementRange, setStatementRange] = useState(() => presetRange('thisYear'));
  const [statement, setStatement] = useState(null);
  const [statementLoading, setStatementLoading] = useState(false);

  const [payments, setPayments] = useState([]);
  const [paymentsRange, setPaymentsRange] = useState(() => presetRange('last30'));
  const [paymentsLoading, setPaymentsLoading] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);

  // Cuotas impagas del cliente elegido en el formulario, y las elegidas para cobrar
  const [payInstallments, setPayInstallments] = useState([]);
  const [selectedIds, setSelectedIds] = useState([]);
  // Cuotas del cliente con el resumen abierto, y la mora de todos
  const [statementInstallments, setStatementInstallments] = useState([]);
  const [overdue, setOverdue] = useState(null);

  // Recargo por mora del comercio (el formulario para cambiarlo) y lo que se cobra en esta cobranza
  // (null = todo lo calculado; si no, lo que se escribió en el campo)
  const [feeForm, setFeeForm] = useState({ rate: '', graceDays: '0' });
  const [savingFee, setSavingFee] = useState(false);
  const [chargedFee, setChargedFee] = useState(null);

  const formRef = useRef(null);
  const sendingRef = useRef(false);
  const requestIdRef = useRef(newRequestId());
  const {
    register,
    handleSubmit,
    reset,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm({ defaultValues: emptyPayment() });
  const formCustomerId = watch('customerId');
  const formDate = watch('date');
  const selectedCustomer = balances.find((b) => b.customerId === formCustomerId);
  const selectedTotal = round2(
    payInstallments.filter((i) => selectedIds.includes(i.id)).reduce((sum, i) => sum + i.amount, 0),
  );
  // Recargo de una cuota a la fecha elegida de la cobranza, con la tasa de su remito
  const feeOf = (inst) =>
    lateFee(
      inst.amount,
      daysLate(inst.dueDate, formDate || toISODate(new Date())),
      inst.lateFeeRate,
      inst.lateFeeGraceDays,
    );
  const computedFee = round2(
    payInstallments.filter((i) => selectedIds.includes(i.id)).reduce((sum, i) => sum + feeOf(i), 0),
  );
  const typedFee = chargedFee === null ? computedFee : Math.max(0, round2(Number(chargedFee) || 0));
  const feeToCharge = Math.min(typedFee, computedFee);
  const totalToCollect = round2(selectedTotal + feeToCharge);

  // Al cambiar las cuotas o la fecha, el recargo vuelve a ser el calculado
  useEffect(() => {
    setChargedFee(null);
  }, [selectedIds, formDate]);

  const loadPayInstallments = async (customerId) => {
    setSelectedIds([]);
    if (!customerId) {
      setPayInstallments([]);
      return;
    }
    try {
      const { data } = await getCustomerInstallments(customerId);
      setPayInstallments(data.filter((i) => !i.paid));
    } catch (err) {
      setPayInstallments([]);
      msg.error(serverMessage(err, 'No se pudieron cargar las cuotas.'), 'form');
    }
  };

  useEffect(() => {
    loadPayInstallments(formCustomerId);
  }, [formCustomerId]);

  const loadOverdue = async () => {
    try {
      const { data } = await getCustomerOverdue();
      setOverdue(data);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo cargar la mora.'), 'overdue');
    }
  };

  const loadFeeConfig = async () => {
    const { data } = await getLateFeeConfig();
    setFeeForm({ rate: data.rate === null ? '' : String(data.rate), graceDays: String(data.graceDays ?? 0) });
  };

  const saveFeeConfig = async (event) => {
    event.preventDefault();
    setSavingFee(true);
    try {
      const { data } = await updateLateFeeConfig({
        rate: feeForm.rate === '' ? null : Number(feeForm.rate),
        graceDays: feeForm.graceDays === '' ? 0 : Number(feeForm.graceDays),
      });
      setFeeForm({ rate: data.rate === null ? '' : String(data.rate), graceDays: String(data.graceDays) });
      msg.success(
        data.rate ? `Recargo guardado: ${data.rate} % mensual.` : 'Listo: no se cobra recargo por mora.',
        'fee',
      );
      await loadOverdue();
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo guardar el recargo.'), 'fee');
    } finally {
      setSavingFee(false);
    }
  };

  const loadBalances = async () => {
    const { data } = await getCustomerBalances();
    setBalances(data);
  };

  const loadPayments = async (range = paymentsRange) => {
    setPaymentsLoading(true);
    try {
      const { data } = await getCustomerPayments(range);
      setPayments(data);
      setPaymentsRange(range);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudieron cargar las cobranzas.'), 'payments');
    } finally {
      setPaymentsLoading(false);
    }
  };

  const loadStatement = async (customerId, range = statementRange) => {
    setStatementLoading(true);
    try {
      const [{ data }, { data: installments }] = await Promise.all([
        getCustomerStatement(customerId, range),
        getCustomerInstallments(customerId),
      ]);
      setStatement(data);
      setStatementInstallments(installments);
      setStatementRange(range);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo cargar el resumen de cuenta.'), 'statement');
    } finally {
      setStatementLoading(false);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        const [, methods] = await Promise.all([
          loadBalances(),
          getPayments(),
          loadPayments(),
          loadOverdue(),
          loadFeeConfig(),
        ]);
        setPaymentMethods(methods.data.filter((p) => p.active !== false));
      } catch {
        msg.error('No se pudo cargar la información. Recargá la página.', 'page');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Después de una cobranza o una anulación: saldos, cobranzas, mora, cuotas y el resumen abierto
  const refresh = async () => {
    await Promise.all([
      loadBalances(),
      loadPayments(),
      loadOverdue(),
      loadPayInstallments(watch('customerId')),
      statementId ? loadStatement(statementId) : null,
    ]);
  };

  const toggleInstallment = (id) =>
    setSelectedIds((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const openStatement = (customerId) => {
    if (statementId === customerId) {
      setStatementId(null);
      setStatement(null);
      return;
    }
    setStatementId(customerId);
    setStatement(null);
    loadStatement(customerId);
  };

  const startPayment = (customerId) => {
    setValue('customerId', customerId);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const onSubmit = async (formData) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    msg.clear();
    try {
      // Se cobran cuotas completas: el importe es la suma de las elegidas
      if (!selectedIds.length) {
        msg.error('Elegí las cuotas que paga el cliente.', 'form');
        return;
      }
      await createCustomerPayment({
        customerId: formData.customerId,
        installmentIds: selectedIds,
        paymentId: formData.paymentId,
        amount: selectedTotal,
        ...(computedFee > 0 ? { lateFee: feeToCharge } : {}),
        date: paymentDate(formData.date),
        reference: formData.reference || null,
        notes: formData.notes || null,
        requestId: requestIdRef.current,
      });
      requestIdRef.current = newRequestId();
      reset({ ...emptyPayment(), customerId: formData.customerId, paymentId: formData.paymentId });
      msg.success(
        `Cobranza de ${money(totalToCollect)} registrada` +
          (feeToCharge > 0 ? ` (incluye ${money(feeToCharge)} de recargo por mora).` : '.'),
        'form',
      );
      await refresh();
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo registrar la cobranza.'), 'form');
    } finally {
      sendingRef.current = false;
    }
  };

  const handleCancel = async (payment) => {
    const reason = await dialog.prompt({
      title: 'Anular cobranza',
      message:
        `Vas a anular la cobranza de ${money(paidTotal(payment))} a ${customerLabel(payment.Customer)} ` +
        `del ${formatDate(payment.date)}. Sus cuotas vuelven a sumar a la deuda y quedan impagas` +
        (Number(payment.lateFee) > 0 ? '; el recargo se vuelve a calcular cuando se cobren.' : '.'),
      label: 'Motivo (opcional)',
      confirmLabel: 'Anular cobranza',
      cancelLabel: 'Volver',
      danger: true,
    });
    if (reason === null) return;
    setCancellingId(payment.id);
    try {
      await cancelCustomerPayment(payment.id, reason);
      await refresh();
      msg.success('Cobranza anulada.', payment.id);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo anular la cobranza.'), payment.id);
    } finally {
      setCancellingId(null);
    }
  };

  const exportOverdue = () =>
    downloadCsv(
      `mora_${overdue.date}.csv`,
      [
        'Cliente',
        'CUIT',
        'Teléfono',
        'Por vencer',
        ...overdue.buckets.map((b) => b.label),
        'Total vencido',
        ...(showFee ? ['Recargo a hoy'] : []),
        'Días de atraso',
      ],
      overdue.customers.map((c) => [
        c.name,
        c.cuit || '',
        c.phone || '',
        c.notDue,
        ...overdue.buckets.map((b) => c[b.key]),
        c.overdue,
        ...(showFee ? [c.lateFee] : []),
        c.maxDaysLate,
      ]),
    );

  if (loading) return <Spinner label="Cargando cuentas corrientes..." />;

  const visibleBalances = balances.filter(
    (b) => !onlyWithBalance || Math.abs(b.balance) >= 0.005 || b.customerId === statementId,
  );
  const totalDebt = balances.reduce((sum, b) => sum + Math.max(b.balance, 0), 0);
  // La columna de recargo: si el comercio cobra, o si queda recargo de remitos hechos con tasa
  const showFee = Boolean(overdue?.lateFeeConfig?.rate || overdue?.totals?.lateFee > 0);
  // Para cobrar: los que no están anonimizados, y los anonimizados solo si todavía deben
  const customerOptions = balances.filter(
    (b) => !b.anonymized || Math.abs(b.balance) >= 0.005 || b.customerId === watch('customerId'),
  );

  return (
    <div className="customer-accounts-page">
      <h1>Cuentas corrientes de clientes</h1>
      <p className="report-note">
        Los remitos con condición «Cuenta corriente» suman a lo que te debe cada cliente, divididos en cuotas con su
        vencimiento. Cada cobranza paga cuotas completas, más el recargo por mora si lo configuraste. El saldo inicial
        de cada cliente se carga al editarlo en Clientes y es una cuota más. Las mesas siempre se cobran al contado.
      </p>
      <FormMessage message={msg.at('page')} />

      <div className="stat-cards">
        <div className="stat-card">
          <span>Total que te deben los clientes</span>
          <strong>{money(totalDebt)}</strong>
        </div>
        {overdue && (
          <div className="stat-card">
            <span>Vencido</span>
            <strong>{money(overdue.totals.overdue)}</strong>
            <small>
              {overdue.totals.customers} {overdue.totals.customers === 1 ? 'cliente' : 'clientes'} en mora
            </small>
          </div>
        )}
      </div>

      <form ref={formRef} onSubmit={handleSubmit(onSubmit)} className="customer-payment-form">
        <h2 className="form-title">Registrar una cobranza</h2>
        <div className="field">
          <label htmlFor="pay-customer">
            Cliente
            <RequiredMark />
          </label>
          <select id="pay-customer" {...register('customerId', { required: 'Elegí el cliente' })}>
            <option value="">Elegí un cliente…</option>
            {customerOptions.map((b) => (
              <option key={b.customerId} value={b.customerId}>
                {b.name}
              </option>
            ))}
          </select>
          {selectedCustomer && <small>{balanceLabel(selectedCustomer.balance)}</small>}
          {errors.customerId && <span className="error">{errors.customerId.message}</span>}
        </div>
        <div className="field">
          <label htmlFor="pay-date">
            Fecha
            <RequiredMark />
          </label>
          <input
            id="pay-date"
            type="date"
            max={toISODate(new Date())}
            {...register('date', { required: 'Elegí la fecha' })}
          />
          {errors.date && <span className="error">{errors.date.message}</span>}
        </div>
        <div className="field field-full">
          <span className="field-label">
            Cuotas que paga
            <RequiredMark />
          </span>
          {!formCustomerId && <small>Elegí el cliente para ver sus cuotas.</small>}
          {formCustomerId && payInstallments.length === 0 && <small>Este cliente no tiene cuotas impagas.</small>}
          {payInstallments.length > 0 && (
            <div className="installment-pick">
              {payInstallments.map((inst) => (
                <label key={inst.id}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(inst.id)}
                    onChange={() => toggleInstallment(inst.id)}
                  />
                  <span>
                    {installmentLabel(inst)} · {money(inst.amount)} · vence el {formatKey(inst.dueDate)}
                    {inst.daysLate > 0 && <span className="installment-overdue"> · {installmentStatus(inst)}</span>}
                    {feeOf(inst) > 0 && <span className="installment-overdue"> · + {money(feeOf(inst))} de mora</span>}
                  </span>
                </label>
              ))}
            </div>
          )}
          {computedFee > 0 ? (
            <small>
              Cuotas: {money(selectedTotal)} + recargo por mora: {money(feeToCharge)} · Total a cobrar:{' '}
              <strong>{money(totalToCollect)}</strong>
            </small>
          ) : (
            <small>
              Total a cobrar: <strong>{money(selectedTotal)}</strong> (las cuotas se cobran completas)
            </small>
          )}
        </div>
        {computedFee > 0 && (
          <div className="field">
            <label htmlFor="pay-late-fee">Recargo por mora que se cobra</label>
            <input
              id="pay-late-fee"
              type="number"
              min="0"
              max={computedFee}
              step="0.01"
              value={chargedFee === null ? String(computedFee) : chargedFee}
              onChange={(e) => setChargedFee(e.target.value)}
            />
            <small>
              Calculado: {money(computedFee)}, con la tasa de cada remito. Podés bajarlo o ponerlo en 0 para perdonarlo.
            </small>
            {typedFee > computedFee && <span className="error">No puede ser más que lo calculado.</span>}
          </div>
        )}
        <div className="field">
          <label htmlFor="pay-method">
            Forma de pago
            <RequiredMark />
          </label>
          <select id="pay-method" {...register('paymentId', { required: 'Elegí la forma de pago' })}>
            <option value="">Elegí…</option>
            {paymentMethods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {errors.paymentId && <span className="error">{errors.paymentId.message}</span>}
        </div>
        <div className="field">
          <label htmlFor="pay-reference">Referencia</label>
          <input
            id="pay-reference"
            maxLength={100}
            placeholder="N° de transferencia o cheque"
            {...register('reference')}
          />
        </div>
        <div className="field">
          <label htmlFor="pay-notes">Notas</label>
          <input id="pay-notes" maxLength={255} {...register('notes')} />
        </div>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Registrando…' : 'Registrar cobranza'}
        </button>
        <FormMessage message={msg.at('form')} onClose={msg.clear} />
        <RequiredLegend />
      </form>

      <h2 className="report-subtitle">Saldos</h2>
      <label className="checkbox-inline">
        <input type="checkbox" checked={onlyWithBalance} onChange={(e) => setOnlyWithBalance(e.target.checked)} />
        Solo los que tienen saldo
      </label>
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Saldo</th>
              <th>Último movimiento</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visibleBalances.length === 0 && (
              <tr>
                <td colSpan={4} className="list-search-empty">
                  {onlyWithBalance ? 'Ningún cliente te debe nada.' : 'Todavía no hay clientes.'}
                </td>
              </tr>
            )}
            {visibleBalances.map((b) => (
              <tr key={b.customerId} className={b.customerId === statementId ? 'row-selected' : undefined}>
                <td data-label="Cliente">
                  {b.name}
                  {b.cuit && <small className="row-author">CUIT {b.cuit}</small>}
                </td>
                <td data-label="Saldo">
                  <span className={b.balance > 0.005 ? 'amount amount-debt' : 'amount'}>{balanceLabel(b.balance)}</span>
                </td>
                <td data-label="Último movimiento">{b.lastMovementAt ? formatDate(b.lastMovementAt) : '—'}</td>
                <td data-label="Acciones">
                  <button type="button" onClick={() => openStatement(b.customerId)}>
                    {statementId === b.customerId ? 'Cerrar cuenta' : 'Ver cuenta'}
                  </button>
                  <button type="button" onClick={() => startPayment(b.customerId)}>
                    Cobrar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {statementId && (
        <section className="customer-statement">
          <h2 className="report-subtitle">
            Resumen de cuenta: {balances.find((b) => b.customerId === statementId)?.name}
          </h2>
          <DateRangeFilter
            value={statementRange}
            loading={statementLoading}
            label="Período"
            onChange={(range) => loadStatement(statementId, range)}
          />
          <FormMessage message={msg.at('statement')} />
          {statementLoading && !statement && <Spinner label="Cargando resumen..." />}
          {statement && (
            <StatementTable
              statement={statement}
              debitLabel="Remitos y recargos"
              creditLabel="Cobranzas"
              formatBalance={balanceLabel}
            />
          )}
          {statement && (
            <div className="report-actions">
              <Link
                to={`/cuentas-clientes/${statementId}/imprimir?from=${statementRange.from}&to=${statementRange.to}`}
              >
                <button type="button">Imprimir resumen</button>
              </Link>
            </div>
          )}
          {statement && (
            <>
              <h3 className="report-subtitle">Cuotas</h3>
              {statementInstallments.length === 0 ? (
                <p className="report-note">Este cliente no tiene cuotas.</p>
              ) : (
                <div className="table-wrapper">
                  <table>
                    <thead>
                      <tr>
                        <th>Concepto</th>
                        <th>Vence</th>
                        <th>Importe</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {statementInstallments.map((inst) => (
                        <tr key={inst.id}>
                          <td data-label="Concepto">{installmentLabel(inst)}</td>
                          <td data-label="Vence">{formatKey(inst.dueDate)}</td>
                          <td data-label="Importe">
                            {money(inst.amount)}
                            {inst.lateFee > 0 && (
                              <small className="row-author">
                                {inst.paid ? 'Recargo cobrado' : 'Recargo a hoy'}: {money(inst.lateFee)}
                              </small>
                            )}
                          </td>
                          <td data-label="Estado">
                            <span className={inst.status === 'overdue' ? 'installment-overdue' : undefined}>
                              {installmentStatus(inst)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      )}

      <h2 className="report-subtitle">Mora</h2>
      <p className="report-note">
        Lo que cada cliente tiene vencido e impago a hoy, por días de atraso, y lo que todavía no venció.
        {showFee
          ? ' El recargo a hoy se cobra aparte, junto con las cuotas.'
          : ' Para cobrar recargo por las cuotas vencidas, configuralo más abajo.'}
      </p>
      <FormMessage message={msg.at('overdue')} />
      {overdue && (
        <>
          <div className="report-actions">
            <button type="button" onClick={exportOverdue} disabled={!overdue.customers.length}>
              Exportar CSV
            </button>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Por vencer</th>
                  {overdue.buckets.map((b) => (
                    <th key={b.key}>{b.label}</th>
                  ))}
                  <th>Total vencido</th>
                  {showFee && <th>Recargo a hoy</th>}
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {overdue.customers.length === 0 && (
                  <tr>
                    <td colSpan={overdue.buckets.length + (showFee ? 5 : 4)} className="list-search-empty">
                      No hay cuotas impagas.
                    </td>
                  </tr>
                )}
                {overdue.customers.map((c) => (
                  <tr key={c.customerId}>
                    <td data-label="Cliente">
                      {c.name}
                      {c.maxDaysLate > 0 && (
                        <small className="row-author installment-overdue">
                          Atraso máximo: {c.maxDaysLate} {c.maxDaysLate === 1 ? 'día' : 'días'}
                        </small>
                      )}
                    </td>
                    <td data-label="Por vencer">{money(c.notDue)}</td>
                    {overdue.buckets.map((b) => (
                      <td key={b.key} data-label={b.label}>
                        {c[b.key] ? money(c[b.key]) : '—'}
                      </td>
                    ))}
                    <td data-label="Total vencido">
                      <strong>{money(c.overdue)}</strong>
                    </td>
                    {showFee && <td data-label="Recargo a hoy">{c.lateFee ? money(c.lateFee) : '—'}</td>}
                    <td data-label="Acciones">
                      <button type="button" onClick={() => startPayment(c.customerId)}>
                        Cobrar
                      </button>
                    </td>
                  </tr>
                ))}
                {overdue.customers.length > 0 && (
                  <tr className="row-total">
                    <td data-label="Cliente">
                      <strong>Total</strong>
                    </td>
                    <td data-label="Por vencer">{money(overdue.totals.notDue)}</td>
                    {overdue.buckets.map((b) => (
                      <td key={b.key} data-label={b.label}>
                        {money(overdue.totals[b.key])}
                      </td>
                    ))}
                    <td data-label="Total vencido">
                      <strong>{money(overdue.totals.overdue)}</strong>
                    </td>
                    {showFee && <td data-label="Recargo a hoy">{money(overdue.totals.lateFee)}</td>}
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}

      <h2 className="report-subtitle">Recargo por mora</h2>
      <p className="report-note">
        Opcional. Si cargás un % mensual, las cuotas vencidas suman un interés por cada día de atraso desde el
        vencimiento (por ejemplo, $100.000 al 3 % mensual con 20 días de atraso: $2.000). Si se pagan dentro de los días
        de gracia, no hay recargo. Se cobra aparte, junto con las cuotas, y en cada cobranza se puede perdonar. Cada
        remito a cuenta corriente guarda la tasa vigente al hacerlo, la imprime en la leyenda y sus cuotas cobran con
        esa: si después la cambiás, los remitos anteriores siguen con la suya. Los remitos hechos sin tasa no cobran
        recargo; el saldo inicial usa la tasa vigente. Vacío: los remitos nuevos no cobran recargo.
      </p>
      <form onSubmit={saveFeeConfig} className="customer-payment-form late-fee-form">
        <div className="field">
          <label htmlFor="fee-rate">Interés por mora (% mensual)</label>
          <input
            id="fee-rate"
            type="number"
            min="0"
            max="100"
            step="0.01"
            placeholder="Sin recargo"
            value={feeForm.rate}
            onChange={(e) => setFeeForm((f) => ({ ...f, rate: e.target.value }))}
          />
        </div>
        <div className="field">
          <label htmlFor="fee-grace">Días de gracia</label>
          <input
            id="fee-grace"
            type="number"
            min="0"
            max="90"
            step="1"
            value={feeForm.graceDays}
            onChange={(e) => setFeeForm((f) => ({ ...f, graceDays: e.target.value }))}
          />
          <small>Días después del vencimiento sin recargo.</small>
        </div>
        <button type="submit" disabled={savingFee}>
          {savingFee ? 'Guardando…' : 'Guardar recargo'}
        </button>
        <FormMessage message={msg.at('fee')} onClose={msg.clear} />
      </form>

      <h2 className="report-subtitle">Cobranzas registradas</h2>
      <DateRangeFilter value={paymentsRange} loading={paymentsLoading} label="Cobranzas" onChange={loadPayments} />
      <FormMessage message={msg.at('payments')} />
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Cliente</th>
              <th>Importe</th>
              <th>Forma de pago</th>
              <th>Referencia</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && (
              <tr>
                <td colSpan={6} className="list-search-empty">
                  No hay cobranzas en este período.
                </td>
              </tr>
            )}
            {payments.map((p) => {
              const cancelled = p.status === 'cancelled';
              return (
                <tr key={p.id} className={cancelled ? 'order-cancelled' : ''}>
                  <td data-label="Fecha">
                    {formatDate(p.date)}
                    {p.createdByName && <small className="row-author">por {p.createdByName}</small>}
                  </td>
                  <td data-label="Cliente">
                    {customerLabel(p.Customer)}
                    {cancelled && (
                      <span className="badge-cancelled" title={p.cancelReason || undefined}>
                        Anulada
                      </span>
                    )}
                  </td>
                  <td data-label="Importe">
                    <span className="amount">{money(paidTotal(p))}</span>
                    {Number(p.lateFee) > 0 && (
                      <small className="row-author">Incluye {money(p.lateFee)} de recargo por mora</small>
                    )}
                    {Number(p.lateFeeComputed) - Number(p.lateFee) > 0.005 && (
                      <small className="row-author">
                        Recargo perdonado: {money(Number(p.lateFeeComputed) - Number(p.lateFee))}
                      </small>
                    )}
                  </td>
                  <td data-label="Forma de pago">{p.Payment?.name || '—'}</td>
                  <td data-label="Referencia">
                    {p.reference || '—'}
                    {p.notes && <small className="row-author">{p.notes}</small>}
                  </td>
                  <td data-label="Acciones">
                    {!cancelled && (
                      <button
                        type="button"
                        className="btn-danger"
                        disabled={cancellingId === p.id}
                        onClick={() => handleCancel(p)}
                      >
                        {cancellingId === p.id ? 'Anulando…' : 'Anular'}
                      </button>
                    )}
                    <FormMessage message={msg.at(p.id)} onClose={msg.clear} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default CustomerAccounts;
