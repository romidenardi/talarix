import { useEffect, useState } from 'react';
import * as tablesApi from '../../api/tables.api.js';
import DateRangeFilter from '../../components/common/DateRangeFilter.jsx';
import FormMessage from '../../components/common/FormMessage.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { serverMessage } from '../../utils/serverErrors.js';
import { money, presetRange } from '../../utils/reportFormat.js';

// Propinas por mozo, en el período elegido. No son parte de las ventas.
export default function TipsReport() {
  const [range, setRange] = useState(() => presetRange('thisMonth'));
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const msg = useMessage();

  const load = async (next) => {
    setLoading(true);
    try {
      const { data } = await tablesApi.getTips(next);
      setReport(data);
      setRange(next);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudieron cargar las propinas'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load(range);
  }, []);

  return (
    <div>
      <DateRangeFilter value={range} loading={loading} label="Propinas" onChange={load} />
      <FormMessage message={msg.at()} onClose={msg.clear} />
      {report && (
        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Mozo</th>
                <th>Mesas cobradas</th>
                <th>Ventas</th>
                <th>Propinas</th>
              </tr>
            </thead>
            <tbody>
              {report.waiters.length === 0 && (
                <tr>
                  <td colSpan={4} className="list-search-empty">
                    No hay mesas cobradas en el período
                  </td>
                </tr>
              )}
              {report.waiters.map((w) => (
                <tr key={w.waiter}>
                  <td data-label="Mozo">{w.waiter}</td>
                  <td data-label="Mesas cobradas">{w.tables}</td>
                  <td data-label="Ventas">{money(w.sales)}</td>
                  <td data-label="Propinas">{money(w.tips)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tab-total">
            <strong>Total de propinas: {money(report.total)}</strong>
          </p>
        </div>
      )}
    </div>
  );
}
