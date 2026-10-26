import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import { getDashboard } from '../../api/reports.api';
import { money, int, formatDay } from '../../utils/reportFormat';

const change = (current, previous) => {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 100);
};

function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getDashboard()
      .then((res) => {
        if (active) setData(res.data);
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || 'No se pudo cargar el panel');
      });
    return () => {
      active = false;
    };
  }, []);

  if (error) return <p className="report-error">{error}</p>;
  if (!data) return <p className="report-note">Cargando…</p>;

  const delta = change(data.month.total, data.previous.total);

  return (
    <>
      <div className="stat-cards">
        <div className="stat-card">
          <span>Ventas del mes</span>
          <strong>{money(data.month.total)}</strong>
          <small>
            {delta === null
              ? 'Sin ventas en el mismo tramo del mes anterior'
              : `${delta >= 0 ? '+' : ''}${delta}% vs. el mismo tramo del mes anterior (${money(data.previous.total)})`}
          </small>
        </div>
        <div className="stat-card">
          <span>Remitos del mes</span>
          <strong>{int(data.month.orders)}</strong>
          <small>Desde el {formatDay(data.month.from)}</small>
        </div>
        <div className="stat-card">
          <span>Sin stock</span>
          <strong>{int(data.stock.outCount)}</strong>
          <small>
            {int(data.stock.lowCount)} con {data.stock.threshold} unidades o menos
          </small>
        </div>
      </div>

      <div className="report-columns">
        <section>
          <h3>Más vendidos del mes</h3>
          {data.topProducts.length === 0 ? (
            <p className="report-note">Todavía no hay ventas este mes.</p>
          ) : (
            <ol className="home-list">
              {data.topProducts.map((p) => (
                <li key={p.productId}>
                  <span>{p.name}</span>
                  <span>
                    {int(p.units)} u. · {money(p.amount)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section>
          <h3>Poco stock</h3>
          {data.stock.items.length === 0 ? (
            <p className="report-note">Ningún producto con {data.stock.threshold} unidades o menos.</p>
          ) : (
            <ul className="home-list">
              {data.stock.items.map((p) => (
                <li key={p.id}>
                  <span>{p.name}</span>
                  <span>{p.stock} u.</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <p>
        <Link to="/reports">Ver todos los reportes</Link>
      </p>
    </>
  );
}

export default function Home() {
  const { role, user } = useAuth();
  const canSeeReports = role === 'admin' || role === 'editor';

  return (
    <div className="reports-page">
      <h1>Hola{user?.name ? `, ${user.name}` : ''}</h1>
      {canSeeReports ? (
        <Dashboard />
      ) : (
        <p>
          Desde acá podés cargar remitos. <Link to="/orders">Ir a Remitos</Link>
        </p>
      )}
    </div>
  );
}
