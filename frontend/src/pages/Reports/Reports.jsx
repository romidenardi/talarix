import { useEffect, useState } from 'react';
import {
  getSalesSummary,
  getSalesByProduct,
  getSalesByCustomer,
  getSalesByPayment,
  getVatReport,
} from '../../api/reports.api';
import { money, int, presetRange, periodLabel, formatDay, downloadCsv } from '../../utils/reportFormat';

const TABS = [
  ['summary', 'Ventas por período'],
  ['products', 'Por producto'],
  ['customers', 'Por cliente'],
  ['payments', 'Por forma de pago'],
  ['vat', 'IVA'],
  ['internal', 'Impuestos internos'],
  ['taxes', 'IVA + internos'],
];
const PRESETS = [
  ['thisMonth', 'Este mes'],
  ['lastMonth', 'Mes anterior'],
  ['last30', 'Últimos 30 días'],
  ['thisYear', 'Este año'],
];
const GROUPS = [
  ['day', 'Por día'],
  ['week', 'Por semana'],
  ['month', 'Por mes'],
];
const FETCHERS = {
  summary: getSalesSummary,
  products: getSalesByProduct,
  customers: getSalesByCustomer,
  payments: getSalesByPayment,
  vat: getVatReport,
  internal: getVatReport,
  taxes: getVatReport,
};

function ExportButton({ onClick, disabled }) {
  return (
    <button type="button" className="report-export" onClick={onClick} disabled={disabled}>
      Descargar para Excel
    </button>
  );
}

function BarList({ rows, labelKey, valueKey, format = money, max = 10 }) {
  const shown = rows.slice(0, max);
  const top = Math.max(...shown.map((r) => r[valueKey]), 0);
  if (!shown.length) return null;
  return (
    <ul className="bar-list">
      {shown.map((r) => (
        <li key={r[labelKey]}>
          <span className="bar-list-label" title={r[labelKey]}>
            {r[labelKey]}
          </span>
          <span className="bar-list-track">
            <span className="bar-list-fill" style={{ width: `${top ? (r[valueKey] / top) * 100 : 0}%` }} />
          </span>
          <span className="bar-list-value">{format(r[valueKey])}</span>
        </li>
      ))}
    </ul>
  );
}

function SeriesChart({ series, groupBy }) {
  const top = Math.max(...series.map((s) => s.total), 0);
  return (
    <div className="series-chart" role="img" aria-label="Ventas por período">
      {series.map((s) => (
        <div
          key={s.period}
          className="series-bar"
          title={`${periodLabel(s.period, groupBy)}: ${money(s.total)} (${s.orders} remitos)`}
        >
          <span style={{ height: `${top ? Math.max((s.total / top) * 100, s.total > 0 ? 2 : 0) : 0}%` }} />
        </div>
      ))}
    </div>
  );
}

function SummaryView({ data, range }) {
  const { totals, series } = data;
  const groupBy = data.range.groupBy;
  const exportCsv = () =>
    downloadCsv(
      `ventas-por-periodo_${range.from}_${range.to}.csv`,
      ['Período', 'Remitos', 'Total'],
      series.map((s) => [periodLabel(s.period, groupBy), s.orders, s.total]),
    );
  return (
    <>
      <div className="stat-cards">
        <div className="stat-card">
          <span>Total vendido</span>
          <strong>{money(totals.total)}</strong>
        </div>
        <div className="stat-card">
          <span>Remitos</span>
          <strong>{int(totals.orders)}</strong>
        </div>
        <div className="stat-card">
          <span>Ticket promedio</span>
          <strong>{money(totals.avgTicket)}</strong>
        </div>
        <div className="stat-card">
          <span>Descuentos dados</span>
          <strong>{money(totals.discounts)}</strong>
        </div>
        <div className="stat-card">
          <span>Vendido en cuotas</span>
          <strong>{int(totals.installmentOrders)} remitos</strong>
          <small>Financiado: {money(totals.financed)}</small>
        </div>
      </div>
      <SeriesChart series={series} groupBy={groupBy} />
      <div className="report-actions">
        <ExportButton onClick={exportCsv} disabled={!series.length} />
      </div>
      <table className="report-table">
        <thead>
          <tr>
            <th>Período</th>
            <th className="num">Remitos</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {series.map((s) => (
            <tr key={s.period}>
              <td>{periodLabel(s.period, groupBy)}</td>
              <td className="num">{int(s.orders)}</td>
              <td className="num">{money(s.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ProductsView({ data, range }) {
  const exportCsv = () =>
    downloadCsv(
      `ventas-por-producto_${range.from}_${range.to}.csv`,
      ['Código', 'Producto', 'Categoría', 'Unidades', 'Importe'],
      data.products.map((p) => [p.code, p.name, p.category, p.units, p.amount]),
    );
  return (
    <>
      <p className="report-note">
        El importe ya incluye los descuentos de cada remito, por eso la suma coincide con el total vendido.
      </p>
      <div className="report-columns">
        <section>
          <h3>Productos más vendidos</h3>
          <BarList rows={data.products} labelKey="name" valueKey="amount" />
        </section>
        <section>
          <h3>Por categoría</h3>
          <BarList rows={data.categories} labelKey="category" valueKey="amount" />
        </section>
      </div>
      <div className="report-actions">
        <ExportButton onClick={exportCsv} disabled={!data.products.length} />
      </div>
      <table className="report-table">
        <thead>
          <tr>
            <th>Código</th>
            <th>Producto</th>
            <th>Categoría</th>
            <th className="num">Unidades</th>
            <th className="num">Importe</th>
          </tr>
        </thead>
        <tbody>
          {data.products.map((p) => (
            <tr key={p.productId}>
              <td>{p.code}</td>
              <td>{p.name}</td>
              <td>{p.category}</td>
              <td className="num">{int(p.units)}</td>
              <td className="num">{money(p.amount)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function CustomersView({ data, range }) {
  const exportCsv = () =>
    downloadCsv(
      `ventas-por-cliente_${range.from}_${range.to}.csv`,
      ['Cliente', 'Remitos', 'Total', 'Ticket promedio', 'Última compra'],
      data.customers.map((c) => [c.name, c.orders, c.total, c.avgTicket, formatDay(c.lastPurchase)]),
    );
  return (
    <>
      <BarList rows={data.customers} labelKey="name" valueKey="total" />
      <div className="report-actions">
        <ExportButton onClick={exportCsv} disabled={!data.customers.length} />
      </div>
      <table className="report-table">
        <thead>
          <tr>
            <th>Cliente</th>
            <th className="num">Remitos</th>
            <th className="num">Total</th>
            <th className="num">Ticket promedio</th>
            <th>Última compra</th>
          </tr>
        </thead>
        <tbody>
          {data.customers.map((c) => (
            <tr key={c.customerId}>
              <td>{c.name}</td>
              <td className="num">{int(c.orders)}</td>
              <td className="num">{money(c.total)}</td>
              <td className="num">{money(c.avgTicket)}</td>
              <td>{formatDay(c.lastPurchase)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function PaymentsView({ data, range }) {
  const exportCsv = () =>
    downloadCsv(
      `ventas-por-forma-de-pago_${range.from}_${range.to}.csv`,
      ['Forma de pago', 'Remitos', 'Total', '% del total', 'Remitos en cuotas', 'Total financiado'],
      data.payments.map((p) => [p.name, p.orders, p.total, p.share, p.installmentOrders, p.financed]),
    );
  return (
    <>
      <p className="report-note">
        Las cuotas son informativas: acá se ve lo vendido en cuotas y el total financiado, no lo cobrado.
      </p>
      <BarList rows={data.payments} labelKey="name" valueKey="total" />
      <div className="report-actions">
        <ExportButton onClick={exportCsv} disabled={!data.payments.length} />
      </div>
      <table className="report-table">
        <thead>
          <tr>
            <th>Forma de pago</th>
            <th className="num">Remitos</th>
            <th className="num">Total</th>
            <th className="num">% del total</th>
            <th className="num">En cuotas</th>
            <th className="num">Financiado</th>
          </tr>
        </thead>
        <tbody>
          {data.payments.map((p) => (
            <tr key={p.paymentId}>
              <td>{p.name}</td>
              <td className="num">{int(p.orders)}</td>
              <td className="num">{money(p.total)}</td>
              <td className="num">{p.share}%</td>
              <td className="num">{int(p.installmentOrders)}</td>
              <td className="num">{money(p.financed)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function VatView({ data, range }) {
  const exportCsv = () =>
    downloadCsv(
      `iva-ventas_${range.from}_${range.to}.csv`,
      ['Alícuota %', 'Neto', 'IVA', 'Total'],
      data.byRate.map((r) => [r.rate, r.net, r.vat, r.total]),
    );
  const { discriminated, notDiscriminated } = data;
  return (
    <>
      <p className="report-note">
        Es un apoyo para tu contador, no un libro de IVA oficial. Solo se discrimina el IVA en los remitos a
        Responsables Inscriptos; el desglose por alícuota usa la alícuota actual de cada producto.
      </p>
      <div className="stat-cards">
        <div className="stat-card">
          <span>Remitos con IVA discriminado</span>
          <strong>{int(discriminated.orders)}</strong>
          <small>Total: {money(discriminated.total)}</small>
        </div>
        <div className="stat-card">
          <span>Neto gravado</span>
          <strong>{money(discriminated.net)}</strong>
        </div>
        <div className="stat-card">
          <span>IVA de ventas</span>
          <strong>{money(discriminated.vat)}</strong>
        </div>
        <div className="stat-card">
          <span>Remitos sin discriminar</span>
          <strong>{int(notDiscriminated.orders)}</strong>
          <small>Total: {money(notDiscriminated.total)}</small>
        </div>
      </div>
      <div className="report-actions">
        <ExportButton onClick={exportCsv} disabled={!data.byRate.length} />
      </div>
      <table className="report-table">
        <thead>
          <tr>
            <th className="num">Alícuota</th>
            <th className="num">Neto</th>
            <th className="num">IVA</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.byRate.map((r) => (
            <tr key={r.rate}>
              <td className="num">{r.rate}%</td>
              <td className="num">{money(r.net)}</td>
              <td className="num">{money(r.vat)}</td>
              <td className="num">{money(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// Los impuestos internos se discriminan igual que el IVA: solo en remitos a Responsables Inscriptos
function InternalTaxView({ data, range }) {
  const { discriminated, notDiscriminated } = data;
  const rows = data.byInternalRate || [];
  const exportCsv = () =>
    downloadCsv(
      `impuestos-internos_${range.from}_${range.to}.csv`,
      ['Impuestos internos %', 'Neto', 'Impuestos internos', 'Total'],
      rows.map((r) => [r.rate, r.net, r.internal, r.total]),
    );
  return (
    <>
      <p className="report-note">
        Es un apoyo para tu contador. Solo se discriminan en los remitos a Responsables Inscriptos; el desglose usa el
        porcentaje actual de cada producto.
      </p>
      <div className="stat-cards">
        <div className="stat-card">
          <span>Remitos con impuestos discriminados</span>
          <strong>{int(discriminated.orders)}</strong>
          <small>Total: {money(discriminated.total)}</small>
        </div>
        <div className="stat-card">
          <span>Neto gravado</span>
          <strong>{money(discriminated.net)}</strong>
        </div>
        <div className="stat-card">
          <span>Impuestos internos de ventas</span>
          <strong>{money(discriminated.internal)}</strong>
        </div>
        <div className="stat-card">
          <span>Remitos sin discriminar</span>
          <strong>{int(notDiscriminated.orders)}</strong>
          <small>Total: {money(notDiscriminated.total)}</small>
        </div>
      </div>
      <div className="report-actions">
        <ExportButton onClick={exportCsv} disabled={!rows.length} />
      </div>
      {rows.length ? (
        <table className="report-table">
          <thead>
            <tr>
              <th className="num">Impuestos internos</th>
              <th className="num">Neto</th>
              <th className="num">Importe</th>
              <th className="num">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.rate}>
                <td className="num">{r.rate}%</td>
                <td className="num">{money(r.net)}</td>
                <td className="num">{money(r.internal)}</td>
                <td className="num">{money(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="report-note">No hay ventas con impuestos internos en este período.</p>
      )}
    </>
  );
}

function TaxesView({ data, range }) {
  const { discriminated, notDiscriminated } = data;
  const taxTotal = (Number(discriminated.vat) || 0) + (Number(discriminated.internal) || 0);
  const exportCsv = () =>
    downloadCsv(
      `iva-e-impuestos-internos_${range.from}_${range.to}.csv`,
      ['Alícuota IVA %', 'Neto', 'IVA', 'Impuestos internos', 'Total impuestos', 'Total'],
      data.byRate.map((r) => [r.rate, r.net, r.vat, r.internal, r.vat + r.internal, r.total]),
    );
  return (
    <>
      <p className="report-note">
        Suma el IVA y los impuestos internos de los remitos a Responsables Inscriptos. Es un apoyo para tu contador; el
        desglose por alícuota usa la alícuota actual de cada producto.
      </p>
      <div className="stat-cards">
        <div className="stat-card">
          <span>Remitos con impuestos discriminados</span>
          <strong>{int(discriminated.orders)}</strong>
          <small>Total: {money(discriminated.total)}</small>
        </div>
        <div className="stat-card">
          <span>IVA de ventas</span>
          <strong>{money(discriminated.vat)}</strong>
        </div>
        <div className="stat-card">
          <span>Impuestos internos</span>
          <strong>{money(discriminated.internal)}</strong>
        </div>
        <div className="stat-card">
          <span>IVA + impuestos internos</span>
          <strong>{money(taxTotal)}</strong>
        </div>
        <div className="stat-card">
          <span>Remitos sin discriminar</span>
          <strong>{int(notDiscriminated.orders)}</strong>
          <small>Total: {money(notDiscriminated.total)}</small>
        </div>
      </div>
      <div className="report-actions">
        <ExportButton onClick={exportCsv} disabled={!data.byRate.length} />
      </div>
      <table className="report-table">
        <thead>
          <tr>
            <th className="num">Alícuota IVA</th>
            <th className="num">Neto</th>
            <th className="num">IVA</th>
            <th className="num">Imp. internos</th>
            <th className="num">Total impuestos</th>
            <th className="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.byRate.map((r) => (
            <tr key={r.rate}>
              <td className="num">{r.rate}%</td>
              <td className="num">{money(r.net)}</td>
              <td className="num">{money(r.vat)}</td>
              <td className="num">{money(r.internal)}</td>
              <td className="num">{money(r.vat + r.internal)}</td>
              <td className="num">{money(r.total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

const VIEWS = {
  summary: SummaryView,
  products: ProductsView,
  customers: CustomersView,
  payments: PaymentsView,
  vat: VatView,
  internal: InternalTaxView,
  taxes: TaxesView,
};

export default function Reports() {
  const initial = presetRange('thisMonth');
  const [tab, setTab] = useState('summary');
  const [preset, setPreset] = useState('thisMonth');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [groupBy, setGroupBy] = useState('day');
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!from || !to) return undefined;
    let active = true;
    setLoading(true);
    setError('');
    setResult(null);
    FETCHERS[tab]({ from, to, groupBy })
      .then((res) => {
        if (active) setResult({ tab, data: res.data });
      })
      .catch((err) => {
        if (active) setError(err.response?.data?.message || 'No se pudo cargar el reporte');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [tab, from, to, groupBy]);

  const choosePreset = (key) => {
    const range = presetRange(key);
    setPreset(key);
    setFrom(range.from);
    setTo(range.to);
  };

  const View = VIEWS[tab];
  const data = result && result.tab === tab ? result.data : null;

  return (
    <div className="reports-page">
      <h1>Reportes</h1>

      <div className="report-tabs" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            className={tab === key ? 'active' : ''}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="report-filters">
        <div className="report-presets">
          {PRESETS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={preset === key ? 'active' : ''}
              onClick={() => choosePreset(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <label>
          Desde
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => {
              setPreset('');
              setFrom(e.target.value);
            }}
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => {
              setPreset('');
              setTo(e.target.value);
            }}
          />
        </label>
        {tab === 'summary' && (
          <label>
            Agrupar
            <select value={groupBy} onChange={(e) => setGroupBy(e.target.value)}>
              {GROUPS.map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {loading && <p className="report-note">Cargando…</p>}
      {error && <p className="report-error">{error}</p>}
      {data && !loading && <View data={data} range={{ from, to }} />}
      {data && !loading && !error && (
        <p className="report-note">Los remitos anulados no se incluyen en los reportes.</p>
      )}
    </div>
  );
}
