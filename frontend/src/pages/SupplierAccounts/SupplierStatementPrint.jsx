import { useEffect, useState } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import { getSupplierStatement } from '../../api/supplierAccounts.api.js';
import Spinner from '../../components/common/Spinner.jsx';
import StatementTable from './StatementTable.jsx';

const dayLabel = (key) => (key ? new Date(`${key}T12:00:00`).toLocaleDateString('es-AR') : '');

// Resumen de cuenta de un proveedor para imprimir o guardar en PDF (?from&to)
const SupplierStatementPrint = () => {
  const { id } = useParams();
  const [params] = useSearchParams();
  const [statement, setStatement] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getSupplierStatement(id, { from: params.get('from') || undefined, to: params.get('to') || undefined })
      .then(({ data }) => setStatement(data))
      .catch(() => setStatement(null))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spinner label="Cargando resumen..." />;
  if (!statement) return <p>No se pudo cargar el resumen de cuenta.</p>;

  return (
    <div className="print-page">
      <div className="print-actions no-print">
        <Link to="/cuentas-proveedores">
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
          <h2>Proveedor</h2>
          <p>{statement.supplier.name}</p>
          {statement.supplier.cuit && <p>CUIT: {statement.supplier.cuit}</p>}
        </section>

        <StatementTable statement={statement} />

        <p className="print-legend">Documento no válido como factura</p>
      </div>
    </div>
  );
};

export default SupplierStatementPrint;
