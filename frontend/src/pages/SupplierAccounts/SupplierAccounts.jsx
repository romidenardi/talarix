import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { Link } from 'react-router-dom';
import { useDialog } from '../../context/DialogContext.jsx';
import {
  getSupplierBalances,
  getSupplierStatement,
  getSupplierPayments,
  createSupplierPayment,
  cancelSupplierPayment,
} from '../../api/supplierAccounts.api.js';
import { getPayments } from '../../api/payments.api.js';
import Spinner from '../../components/common/Spinner.jsx';
import FormMessage from '../../components/common/FormMessage.jsx';
import DateRangeFilter from '../../components/common/DateRangeFilter.jsx';
import { RequiredMark, RequiredLegend } from '../../components/common/Required.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { serverMessage } from '../../utils/serverErrors.js';
import { money, presetRange, toISODate } from '../../utils/reportFormat.js';
import { newRequestId } from '../../utils/requestId.js';
import { balanceLabel } from '../../utils/supplierAccounts.js';
import StatementTable from './StatementTable.jsx';

// Cuenta corriente con proveedores. El saldo de cada uno es: saldo inicial + compras a cuenta
// corriente − pagos. Los pagos se aplican a la deuda total, no a una factura.

const formatDate = (value) => new Date(value).toLocaleDateString('es-AR');

// Fecha elegida en el formulario → la que se manda. Hoy: sin fecha (el servidor usa la hora actual,
// así el pago queda después de las compras de hoy). Otro día: al mediodía de Argentina.
const paymentDate = (day) => (day && day !== toISODate(new Date()) ? `${day}T12:00:00-03:00` : undefined);

const emptyPayment = () => ({
  supplierId: '',
  date: toISODate(new Date()),
  amount: '',
  paymentId: '',
  reference: '',
  notes: '',
});

const SupplierAccounts = () => {
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
  const selectedSupplier = balances.find((b) => b.supplierId === watch('supplierId'));

  const loadBalances = async () => {
    const { data } = await getSupplierBalances();
    setBalances(data);
  };

  const loadPayments = async (range = paymentsRange) => {
    setPaymentsLoading(true);
    try {
      const { data } = await getSupplierPayments(range);
      setPayments(data);
      setPaymentsRange(range);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudieron cargar los pagos.'), 'payments');
    } finally {
      setPaymentsLoading(false);
    }
  };

  const loadStatement = async (supplierId, range = statementRange) => {
    setStatementLoading(true);
    try {
      const { data } = await getSupplierStatement(supplierId, range);
      setStatement(data);
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
        const [, methods] = await Promise.all([loadBalances(), getPayments(), loadPayments()]);
        setPaymentMethods(methods.data.filter((p) => p.active !== false));
      } catch {
        msg.error('No se pudo cargar la información. Recargá la página.', 'page');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Después de un pago o una anulación: saldos, pagos y el resumen abierto
  const refresh = async () => {
    await Promise.all([loadBalances(), loadPayments(), statementId ? loadStatement(statementId) : null]);
  };

  const openStatement = (supplierId) => {
    if (statementId === supplierId) {
      setStatementId(null);
      setStatement(null);
      return;
    }
    setStatementId(supplierId);
    setStatement(null);
    loadStatement(supplierId);
  };

  const startPayment = (supplierId) => {
    setValue('supplierId', supplierId);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const onSubmit = async (formData) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    msg.clear();
    try {
      const supplier = balances.find((b) => b.supplierId === formData.supplierId);
      const amount = Number(formData.amount);
      // Pagar más de lo que se debe deja saldo a favor: se confirma antes
      if (supplier && amount > supplier.balance + 0.005) {
        const ok = await dialog.confirm({
          title: 'Pago mayor a la deuda',
          message:
            `${supplier.name}: ${balanceLabel(supplier.balance)}. Si registrás ${money(amount)}, ` +
            `te queda a favor ${money(amount - Math.max(supplier.balance, 0))}. ¿Registrarlo igual?`,
          confirmLabel: 'Registrar',
          cancelLabel: 'Volver',
        });
        if (!ok) return;
      }
      await createSupplierPayment({
        supplierId: formData.supplierId,
        paymentId: formData.paymentId,
        amount,
        date: paymentDate(formData.date),
        reference: formData.reference || null,
        notes: formData.notes || null,
        requestId: requestIdRef.current,
      });
      requestIdRef.current = newRequestId();
      reset(emptyPayment());
      msg.success('Pago registrado.', 'form');
      await refresh();
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo registrar el pago.'), 'form');
    } finally {
      sendingRef.current = false;
    }
  };

  const handleCancel = async (payment) => {
    const reason = await dialog.prompt({
      title: 'Anular pago',
      message:
        `Vas a anular el pago de ${money(payment.amount)} a ${payment.Supplier?.name || 'este proveedor'} ` +
        `del ${formatDate(payment.date)}. El importe vuelve a sumar a la deuda.`,
      label: 'Motivo (opcional)',
      confirmLabel: 'Anular pago',
      cancelLabel: 'Volver',
      danger: true,
    });
    if (reason === null) return;
    setCancellingId(payment.id);
    try {
      await cancelSupplierPayment(payment.id, reason);
      await refresh();
      msg.success('Pago anulado.', payment.id);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo anular el pago.'), payment.id);
    } finally {
      setCancellingId(null);
    }
  };

  if (loading) return <Spinner label="Cargando cuentas corrientes..." />;

  const visibleBalances = balances.filter(
    (b) => !onlyWithBalance || Math.abs(b.balance) >= 0.005 || b.supplierId === statementId,
  );
  const totalDebt = balances.reduce((sum, b) => sum + Math.max(b.balance, 0), 0);
  const supplierOptions = balances.filter((b) => b.active !== false || b.supplierId === watch('supplierId'));

  return (
    <div className="supplier-accounts-page">
      <h1>Cuentas corrientes de proveedores</h1>
      <p className="report-note">
        Las compras marcadas como «Cuenta corriente» suman a lo que le debés a cada proveedor, y los pagos lo
        descuentan. Cada pago se aplica a la deuda total, no a una factura en particular. El saldo inicial de cada
        proveedor se carga al editarlo en Proveedores.
      </p>
      <FormMessage message={msg.at('page')} />

      <div className="stat-cards">
        <div className="stat-card">
          <span>Deuda total con proveedores</span>
          <strong>{money(totalDebt)}</strong>
        </div>
      </div>

      <form ref={formRef} onSubmit={handleSubmit(onSubmit)} className="supplier-payment-form">
        <h2 className="form-title">Registrar un pago</h2>
        <div className="field">
          <label htmlFor="pay-supplier">
            Proveedor
            <RequiredMark />
          </label>
          <select id="pay-supplier" {...register('supplierId', { required: 'Elegí el proveedor' })}>
            <option value="">Elegí un proveedor…</option>
            {supplierOptions.map((b) => (
              <option key={b.supplierId} value={b.supplierId}>
                {b.name}
              </option>
            ))}
          </select>
          {selectedSupplier && <small>{balanceLabel(selectedSupplier.balance)}</small>}
          {errors.supplierId && <span className="error">{errors.supplierId.message}</span>}
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
        <div className="field">
          <label htmlFor="pay-amount">
            Importe
            <RequiredMark />
          </label>
          <input
            id="pay-amount"
            type="number"
            step="0.01"
            placeholder="Ej: 150000"
            {...register('amount', {
              required: 'Cargá el importe',
              min: { value: 0.01, message: 'El importe tiene que ser mayor a 0' },
            })}
          />
          {errors.amount && <span className="error">{errors.amount.message}</span>}
        </div>
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
          {isSubmitting ? 'Registrando…' : 'Registrar pago'}
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
              <th>Proveedor</th>
              <th>Saldo</th>
              <th>Último movimiento</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            {visibleBalances.length === 0 && (
              <tr>
                <td colSpan={4} className="list-search-empty">
                  {onlyWithBalance ? 'No le debés nada a ningún proveedor.' : 'Todavía no hay proveedores.'}
                </td>
              </tr>
            )}
            {visibleBalances.map((b) => (
              <tr key={b.supplierId} className={b.supplierId === statementId ? 'row-selected' : undefined}>
                <td data-label="Proveedor">
                  {b.name}
                  {b.active === false && <small> · Inactivo</small>}
                </td>
                <td data-label="Saldo">
                  <span className={b.balance > 0.005 ? 'amount amount-debt' : 'amount'}>{balanceLabel(b.balance)}</span>
                </td>
                <td data-label="Último movimiento">{b.lastMovementAt ? formatDate(b.lastMovementAt) : '—'}</td>
                <td data-label="Acciones">
                  <button type="button" onClick={() => openStatement(b.supplierId)}>
                    {statementId === b.supplierId ? 'Cerrar cuenta' : 'Ver cuenta'}
                  </button>
                  <button type="button" onClick={() => startPayment(b.supplierId)}>
                    Pagar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {statementId && (
        <section className="supplier-statement">
          <h2 className="report-subtitle">
            Resumen de cuenta: {balances.find((b) => b.supplierId === statementId)?.name}
          </h2>
          <DateRangeFilter
            value={statementRange}
            loading={statementLoading}
            label="Período"
            onChange={(range) => loadStatement(statementId, range)}
          />
          <FormMessage message={msg.at('statement')} />
          {statementLoading && !statement && <Spinner label="Cargando resumen..." />}
          {statement && <StatementTable statement={statement} />}
          {statement && (
            <div className="report-actions">
              <Link
                to={`/cuentas-proveedores/${statementId}/imprimir?from=${statementRange.from}&to=${statementRange.to}`}
              >
                <button type="button">Imprimir resumen</button>
              </Link>
            </div>
          )}
        </section>
      )}

      <h2 className="report-subtitle">Pagos registrados</h2>
      <DateRangeFilter value={paymentsRange} loading={paymentsLoading} label="Pagos" onChange={loadPayments} />
      <FormMessage message={msg.at('payments')} />
      <div className="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Proveedor</th>
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
                  No hay pagos en este período.
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
                  <td data-label="Proveedor">
                    {p.Supplier?.name || '—'}
                    {cancelled && (
                      <span className="badge-cancelled" title={p.cancelReason || undefined}>
                        Anulado
                      </span>
                    )}
                  </td>
                  <td data-label="Importe">
                    <span className="amount">{money(p.amount)}</span>
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

export default SupplierAccounts;
