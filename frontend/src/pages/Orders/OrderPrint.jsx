import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getOrder } from '../../api/orders.api.js';
import Spinner from '../../components/common/Spinner.jsx';
import { formatQuantity, perKg } from '../../utils/quantity.js';
import { orderNumberLabel } from '../../utils/orderNumber.js';
import { paymentParts } from '../../utils/orderPayments.js';
import { formatRate } from '../../utils/taxes.js';
import { money } from '../../utils/reportFormat.js';

const OrderPrint = () => {
  const { id } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getOrder(id)
      .then(({ data }) => setOrder(data))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spinner label="Cargando remito..." />;
  if (!order) return <p>Remito no encontrado.</p>;

  const customerLabel =
    order.Customer.businessName || `${order.Customer.firstName} ${order.Customer.lastName || ''}`.trim();

  const hasDiscount = Number(order.discountPercent) > 0 || Number(order.discountAmount) > 0;
  const totalDiscount = Number(order.grossTotal || 0) - Number(order.total || 0);
  const cancelled = order.status === 'cancelled';
  const parts = paymentParts(order);

  return (
    <div className="print-page">
      <div className="print-actions no-print">
        <Link to="/orders">
          <button type="button">← Volver</button>
        </Link>
        <button onClick={() => window.print()}>Imprimir</button>
      </div>

      <div className="print-sheet">
        {cancelled && (
          <div className="cancelled-banner">
            REMITO ANULADO
            <small>
              {order.cancelledAt && `Anulado el ${new Date(order.cancelledAt).toLocaleDateString('es-AR')}`}
              {order.cancelReason && ` · Motivo: ${order.cancelReason}`}
            </small>
          </div>
        )}

        <div className="print-doc-letter" aria-label="Documento tipo R">
          R
        </div>

        <header className="print-header">
          <h1>Remito</h1>
          <p>N° {orderNumberLabel(order)}</p>
          <p>{new Date(order.date).toLocaleDateString('es-AR')}</p>
        </header>

        <section className="print-customer">
          <h3>Cliente</h3>
          <p>{customerLabel}</p>
          <p>{order.Customer.fiscalCondition}</p>
          {order.Customer.cuit && <p>CUIT: {order.Customer.cuit}</p>}
          {order.Customer.address && (
            <p>
              {order.Customer.address}, {order.Customer.city}
            </p>
          )}
        </section>

        <table className="print-items">
          <thead>
            <tr>
              <th>Producto</th>
              <th>Cantidad</th>
              <th>Precio unit.</th>
              <th>Subtotal</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.id}>
                <td>
                  {item.Product?.name}
                  {Array.isArray(item.components) && item.components.length > 0 && (
                    <small style={{ display: 'block' }}>
                      Incluye: {item.components.map((c) => `${c.quantity}× ${c.name}`).join(', ')}
                    </small>
                  )}
                </td>
                <td>{formatQuantity(item.quantity, item.Product?.unitType)}</td>
                <td>
                  {money(Number(item.unitPrice))}
                  {perKg(item.Product?.unitType)}
                </td>
                <td>{money(Math.round(Number(item.quantity) * Number(item.unitPrice) * 100) / 100)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="print-total">
          {hasDiscount && (
            <>
              <p>Importe: {money(Number(order.grossTotal))}</p>
              <p>
                Descuento: -{money(totalDiscount)}
                {Number(order.discountPercent) > 0 && ` (${formatRate(order.discountPercent)}`}
                {Number(order.discountPercent) > 0 && Number(order.discountAmount) > 0 && ' + '}
                {Number(order.discountAmount) > 0 && `bono ${money(Number(order.discountAmount))}`}
                {Number(order.discountPercent) > 0 && ')'}
              </p>
            </>
          )}

          {order.discriminatesVat ? (
            <>
              <p>Subtotal: {money(Number(order.subtotal))}</p>
              {Array.isArray(order.vatBreakdown) && order.vatBreakdown.some((row) => row.rate > 0) ? (
                order.vatBreakdown
                  .filter((row) => row.rate > 0)
                  .map((row) => (
                    <p key={row.rate}>
                      IVA {formatRate(row.rate)}: {money(Number(row.vat))}
                    </p>
                  ))
              ) : (
                <p>IVA: {money(Number(order.vatAmount))}</p>
              )}
              {Number(order.internalTaxAmount) > 0 && (
                <p>Impuestos internos: {money(Number(order.internalTaxAmount))}</p>
              )}
              <p>
                <strong>Total: {money(Number(order.total))}</strong>
              </p>
            </>
          ) : (
            <p>
              <strong>Total: {money(Number(order.total))}</strong>
            </p>
          )}

          {order.installmentsCount && order.paymentCondition !== 'account' && (
            <>
              <p>
                Plan: {order.installmentsCount} cuotas{' '}
                {Number(order.interestRate) > 0 ? `(+${formatRate(order.interestRate)} interés)` : '(sin interés)'}
              </p>
              <p>Monto de cada cuota: {money(Number(order.installmentAmount))}</p>
              <p>
                <strong>Total financiado: {money(Number(order.totalFinanced))}</strong>
              </p>
            </>
          )}
        </div>

        {order.paymentCondition === 'account' ? (
          <div className="print-payment">
            <p>
              Condición: Cuenta corriente
              {Number(order.installmentsCount) > 1 ? ` en ${order.installmentsCount} cuotas` : ''}
              {Number(order.interestRate) > 0 ? ` (+${formatRate(order.interestRate)} interés)` : ''}
            </p>
            {Number(order.interestRate) > 0 && (
              <p>
                <strong>Total con interés: {money(Number(order.totalFinanced))}</strong>
              </p>
            )}
            {order.accountInstallments?.length > 0 && (
              <ul>
                {order.accountInstallments.map((inst) => (
                  <li key={inst.number}>
                    {order.accountInstallments.length > 1 ? `Cuota ${inst.number}: ` : ''}
                    {money(Number(inst.amount))}, vence el {inst.dueDate.split('-').reverse().join('/')}
                  </li>
                ))}
              </ul>
            )}
            {Number(order.lateFeeRate) > 0 && (
              <p className="print-late-fee">
                Las cuotas vencidas devengan un interés punitorio del {formatRate(order.lateFeeRate)} mensual, calculado
                por día de atraso desde el vencimiento
                {Number(order.lateFeeGraceDays) > 0
                  ? `, si se pagan después de ${order.lateFeeGraceDays} ${Number(order.lateFeeGraceDays) === 1 ? 'día' : 'días'} de gracia`
                  : ''}
                .
              </p>
            )}
          </div>
        ) : parts.length > 0 ? (
          <div className="print-payment">
            <p>Formas de pago:</p>
            <ul>
              {parts.map((part) => (
                <li key={part.id}>
                  {part.Payment?.name || 'Sin forma de pago.'}: {money(Number(part.amount))}
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="print-payment">Forma de pago: {order.Payment?.name}</p>
        )}
        {order.notes && <p className="print-notes">Notas: {order.notes}</p>}

        <p className="print-legend">Documento no válido como factura</p>
      </div>
    </div>
  );
};

export default OrderPrint;
