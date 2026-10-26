import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { getOrder } from '../../api/orders.api.js';
import Spinner from '../../components/common/Spinner.jsx';
import { formatQuantity, perKg } from '../../utils/quantity.js';
import { orderNumberLabel } from '../../utils/orderNumber.js';

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
                  ${Number(item.unitPrice).toFixed(2)}
                  {perKg(item.Product?.unitType)}
                </td>
                <td>${(Math.round(Number(item.quantity) * Number(item.unitPrice) * 100) / 100).toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="print-total">
          {hasDiscount && (
            <>
              <p>Importe: ${Number(order.grossTotal).toFixed(2)}</p>
              <p>
                Descuento: -${totalDiscount.toFixed(2)}
                {Number(order.discountPercent) > 0 && ` (${order.discountPercent}%`}
                {Number(order.discountPercent) > 0 && Number(order.discountAmount) > 0 && ' + '}
                {Number(order.discountAmount) > 0 && `bono $${Number(order.discountAmount).toFixed(2)}`}
                {Number(order.discountPercent) > 0 && ')'}
              </p>
            </>
          )}

          {order.discriminatesVat ? (
            <>
              <p>Subtotal: ${Number(order.subtotal).toFixed(2)}</p>
              <p>IVA: ${Number(order.vatAmount).toFixed(2)}</p>
              {Number(order.internalTaxAmount) > 0 && (
                <p>Impuestos internos: ${Number(order.internalTaxAmount).toFixed(2)}</p>
              )}
              <p>
                <strong>Total: ${Number(order.total).toFixed(2)}</strong>
              </p>
            </>
          ) : (
            <p>
              <strong>Total: ${Number(order.total).toFixed(2)}</strong>
            </p>
          )}

          {order.installmentsCount && (
            <>
              <p>
                Plan: {order.installmentsCount} cuotas{' '}
                {Number(order.interestRate) > 0 ? `(+${order.interestRate}% interés)` : '(sin interés)'}
              </p>
              <p>Monto de cada cuota: ${Number(order.installmentAmount).toFixed(2)}</p>
              <p>
                <strong>Total financiado: ${Number(order.totalFinanced).toFixed(2)}</strong>
              </p>
            </>
          )}
        </div>

        <p className="print-payment">Forma de pago: {order.Payment?.name}</p>
        {order.notes && <p className="print-notes">Notas: {order.notes}</p>}
      </div>
    </div>
  );
};

export default OrderPrint;
