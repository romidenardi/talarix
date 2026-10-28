import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import * as tablesApi from '../../api/tables.api.js';
import Spinner from '../../components/common/Spinner.jsx';
import { timeLabel, formatQty } from './tableUtils.js';

// Comanda para imprimir en la cocina (ticket angosto, 80 mm). Se abre en otra pestaña y pide imprimir sola.
export default function TicketPrint() {
  const { id } = useParams();
  const [ticket, setTicket] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    tablesApi
      .getTicket(id)
      .then(({ data }) => setTicket(data))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    if (ticket) setTimeout(() => window.print(), 300);
  }, [ticket]);

  if (loading) return <Spinner label="Cargando comanda..." />;
  if (!ticket) return <p>Comanda no encontrada.</p>;

  return (
    <div className="ticket-print">
      <div className="print-actions no-print">
        <button type="button" onClick={() => window.close()}>
          Cerrar
        </button>
        <button type="button" onClick={() => window.print()}>
          Imprimir
        </button>
      </div>
      <div className="ticket-sheet">
        <h1>Mesa {ticket.tab?.table?.name}</h1>
        <p>
          Comanda {ticket.number} · {timeLabel(ticket.createdAt)}
        </p>
        {ticket.tab?.waiterName && <p>Mozo: {ticket.tab.waiterName}</p>}
        <hr />
        <ul>
          {ticket.items.map((item) => (
            <li key={item.id} className={item.status === 'cancelled' ? 'tab-item-cancelled' : ''}>
              <strong>{formatQty(item.quantity)}</strong> {item.name}
              {item.note && <div className="ticket-note">→ {item.note}</div>}
              {item.status === 'cancelled' && <div>ANULADO</div>}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
