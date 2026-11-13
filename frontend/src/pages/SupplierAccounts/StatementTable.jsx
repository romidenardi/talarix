import { money } from '../../utils/reportFormat.js';
import { balanceLabel } from '../../utils/supplierAccounts.js';

const formatDate = (value) => new Date(value).toLocaleDateString('es-AR');

// Tabla del resumen: saldo anterior, cada movimiento con su saldo y el saldo final. La usan la
// pantalla y la versión para imprimir, de proveedores y de clientes (con otros títulos de columna y
// otra forma de decir el saldo).
export default function StatementTable({
  statement,
  debitLabel = 'Compras',
  creditLabel = 'Pagos',
  formatBalance = balanceLabel,
}) {
  return (
    <div className="table-wrapper">
      <table className="report-table statement-table">
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Detalle</th>
            <th className="num">{debitLabel}</th>
            <th className="num">{creditLabel}</th>
            <th className="num">Saldo</th>
          </tr>
        </thead>
        <tbody>
          <tr className="statement-subtotal">
            <td colSpan={4}>Saldo anterior</td>
            <td className="num">{money(statement.previousBalance)}</td>
          </tr>
          {statement.movements.length === 0 && (
            <tr>
              <td colSpan={5} className="list-search-empty">
                Sin movimientos en este período.
              </td>
            </tr>
          )}
          {statement.movements.map((m) => (
            <tr key={`${m.type}-${m.id}`}>
              <td data-label="Fecha">{formatDate(m.date)}</td>
              <td data-label="Detalle">
                {m.description}
                {m.notes && <small className="row-author">{m.notes}</small>}
              </td>
              <td data-label={debitLabel} className="num">
                {m.debit ? money(m.debit) : ''}
              </td>
              <td data-label={creditLabel} className="num">
                {m.credit ? money(m.credit) : ''}
              </td>
              <td data-label="Saldo" className="num">
                {money(m.balance)}
              </td>
            </tr>
          ))}
          <tr className="statement-subtotal">
            <td colSpan={2}>Saldo al cierre</td>
            <td className="num">{money(statement.totals.debit)}</td>
            <td className="num">{money(statement.totals.credit)}</td>
            <td className="num">
              <strong>{formatBalance(statement.balance)}</strong>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
