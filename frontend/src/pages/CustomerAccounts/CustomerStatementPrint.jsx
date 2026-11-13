import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { getCustomerStatement } from '../../api/customerAccounts.api.js';
import Spinner from '../../components/common/Spinner.jsx';
import StatementTable from '../SupplierAccounts/StatementTable.jsx';
import { customerBalanceLabel } from '../../utils/customerAccounts.js';

const dayLabel = (key) => (key ? new Date(`${key}T12:00:00`).toLocaleDateString('es-AR') : '');

// Resumen de cuenta de un cliente para imprimir o guardar en PDF (?from&to), para mandárselo
const CustomerStatementPrint = () => {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getCustomerStatement(id, { from: params.get('from') || undefined, to: params.get('to') || undefined })
      .then(({ data }) => setStatement(data))
      .catch(() => setStatement(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spinner label="Cargando resumen..." />;
  if (!statement) return <p>No se pudo cargar el resumen de cuenta.</p>;

  return (
    <div className="print-page">
      <div className="print-actions no-print">
        <Link to="/cuentas-clientes">
          <button type="button">← Volver</button>
        </Link>
        <button onClick={() => window.print()}>Imprimir</button>
      </div>

      <div className="print-sheet">
        <header className="print-header">
          <h1>Resumen de cuenta corriente</h1>
          <p>
            Del {dayLabel(statement.range.from)} al {dayLabel(statement.range.to)}
          </p>
        </header>

        <section className="print-customer">
          <h2>Cliente</h2>
          <p>{statement.customer.name}</p>
          {statement.customer.cuit && <p>CUIT: {statement.customer.cuit}</p>}
          {statement.customer.address && (
            <p>
              {statement.customer.address}
              {statement.customer.city ? `, ${statement.customer.city}` : ''}
            </p>
          )}
        </section>

        <StatementTable
          statement={statement}
          debitLabel="Remitos"
          creditLabel="Cobranzas"
          formatBalance={customerBalanceLabel}
        />

        <p className="print-legend">Documento no válido como factura</p>
      </div>
    </div>
  );
};

export default CustomerStatementPrint;
