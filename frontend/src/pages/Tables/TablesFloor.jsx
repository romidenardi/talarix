import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import * as tablesApi from '../../api/tables.api.js';
import { getProducts } from '../../api/products.api.js';
import { getPayments } from '../../api/payments.api.js';
import { getCustomers } from '../../api/customers.api.js';
import Spinner from '../../components/common/Spinner.jsx';
import FormMessage from '../../components/common/FormMessage.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { serverMessage } from '../../utils/serverErrors.js';
import { money } from '../../utils/reportFormat.js';
import { STATUS_LABELS, sinceLabel } from './tableUtils.js';
import TabPanel from './TabPanel.jsx';

const REFRESH_MS = 15000;

// El salón: las mesas agrupadas por sector, con su estado. Al tocar una se abre su cuenta.
export default function TablesFloor() {
  const { role } = useAuth();
  const canCharge = ['admin', 'editor', 'operador'].includes(role);
  const [tables, setTables] = useState([]);
  const [products, setProducts] = useState([]);
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const msg = useMessage();

  const loadTables = useCallback(async () => {
    try {
      const { data } = await tablesApi.getTables();
      setTables(data);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudieron cargar las mesas'), 'page');
    }
  }, [msg]);

  useEffect(() => {
    const load = async () => {
      try {
        const [productsRes, paymentsRes, customersRes] = await Promise.all([
          getProducts(),
          canCharge ? getPayments() : Promise.resolve({ data: [] }),
          canCharge ? getCustomers() : Promise.resolve({ data: [] }),
        ]);
        setProducts(productsRes.data);
        setPayments(paymentsRes.data);
        setCustomers(customersRes.data);
        await loadTables();
      } catch (err) {
        msg.error(serverMessage(err, 'No se pudo cargar la información'), 'page');
      } finally {
        setLoading(false);
      }
    };
    load();
    // Las mesas se actualizan solas: otro mozo puede abrir o cerrar una mesa
    const timer = setInterval(loadTables, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  if (loading) return <Spinner label="Cargando mesas..." />;

  const active = tables.filter((t) => t.active || t.tab);
  const areas = [...new Set(active.map((t) => t.area || 'Salón'))];
  const selected = tables.find((t) => t.id === selectedId);

  return (
    <div className="tables-floor">
      <FormMessage message={msg.at('page')} onClose={msg.clear} />
      {active.length === 0 && <p className="report-note">Todavía no hay mesas. Cargalas en la pestaña Configurar.</p>}
      {areas.map((area) => (
        <section key={area} className="tables-area">
          <h2>{area}</h2>
          <div className="tables-grid">
            {active
              .filter((t) => (t.area || 'Salón') === area)
              .map((table) => {
                const status = table.tab ? table.tab.status : 'free';
                return (
                  <button
                    key={table.id}
                    type="button"
                    className={`table-card table-card-${status}${selectedId === table.id ? ' selected' : ''}`}
                    onClick={() => setSelectedId(selectedId === table.id ? null : table.id)}
                  >
                    <strong>Mesa {table.name}</strong>
                    {table.tab ? (
                      <>
                        <span>{STATUS_LABELS[table.tab.status]}</span>
                        <span>
                          {money(table.tab.total)} · {sinceLabel(table.tab.openedAt)}
                        </span>
                        {table.tab.waiterName && <small>{table.tab.waiterName}</small>}
                      </>
                    ) : (
                      <span>Libre</span>
                    )}
                  </button>
                );
              })}
          </div>
        </section>
      ))}

      {selected && (
        <TabPanel
          key={selected.id}
          table={selected}
          products={products}
          payments={payments}
          customers={customers}
          onChanged={loadTables}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
