import { useEffect, useState } from 'react';
import * as tablesApi from '../../api/tables.api.js';
import Spinner from '../../components/common/Spinner.jsx';
import FormMessage from '../../components/common/FormMessage.jsx';
import { useMessage } from '../../hooks/useMessage.js';
import { serverMessage } from '../../utils/serverErrors.js';
import { sinceLabel, timeLabel, formatQty, printTicket } from './tableUtils.js';

const REFRESH_MS = 10000;

// Pantalla de la cocina: las comandas pendientes, de la más vieja a la más nueva. Se actualiza sola.
export default function Kitchen() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const msg = useMessage();

  const load = async () => {
    try {
      const { data } = await tablesApi.getKitchen();
      setTickets(data);
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudieron cargar las comandas'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  const mark = async (ticket, ready) => {
    try {
      await tablesApi.setTicketReady(ticket.id, ready);
      await load();
    } catch (err) {
      msg.error(serverMessage(err, 'No se pudo actualizar la comanda'));
    }
  };

  if (loading) return <Spinner label="Cargando comandas..." />;

  const pending = tickets.filter((t) => t.status === 'pending');
  const ready = tickets.filter((t) => t.status === 'ready');

  const card = (ticket) => (
    <article key={ticket.id} className={`kitchen-ticket kitchen-ticket-${ticket.status}`}>
      <header>
        <strong>
          Mesa {ticket.tab?.table?.name} · Comanda {ticket.number}
        </strong>
        <span>
          {timeLabel(ticket.createdAt)} ({sinceLabel(ticket.createdAt)})
          {ticket.tab?.waiterName && ` · ${ticket.tab.waiterName}`}
        </span>
      </header>
      <ul>
        {ticket.items.map((item) => (
          <li key={item.id} className={item.status === 'cancelled' ? 'tab-item-cancelled' : ''}>
            <strong>{formatQty(item.quantity)}</strong> {item.name}
            {item.note && <em> · {item.note}</em>}
            {item.status === 'cancelled' && <small> · ANULADO</small>}
          </li>
        ))}
      </ul>
      <div className="inline-edit-actions">
        {ticket.status === 'pending' ? (
          <button type="button" onClick={() => mark(ticket, true)}>
            Lista
          </button>
        ) : (
          <button type="button" onClick={() => mark(ticket, false)}>
            Volver a pendiente
          </button>
        )}
        <button type="button" onClick={() => printTicket(ticket.id)}>
          Imprimir
        </button>
      </div>
    </article>
  );

  return (
    <div className="kitchen">
      <FormMessage message={msg.at()} onClose={msg.clear} />
      <h2>Pendientes ({pending.length})</h2>
      {pending.length === 0 && <p className="report-note">No hay comandas pendientes.</p>}
      <div className="kitchen-grid">{pending.map(card)}</div>
      {ready.length > 0 && (
        <>
          <h2>Listas en la última hora</h2>
          <div className="kitchen-grid">{ready.map(card)}</div>
        </>
      )}
    </div>
  );
}
