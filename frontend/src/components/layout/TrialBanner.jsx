import { useEffect, useState } from 'react';
import { getSession } from '../../api/auth.api';

const DAY_MS = 24 * 60 * 60 * 1000;
// A partir de cuántos días antes del vencimiento el aviso se destaca
const WARN_DAYS = 7;

const dateLabel = (date) => date.toLocaleDateString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' });

// Aviso con la fecha en que vence la prueba gratis (Términos, cláusula 16.1). Lo ven todos los
// usuarios del comercio. Sin fecha (plan pago o sin vencimiento) no muestra nada.
export default function TrialBanner() {
  const [trialEndsAt, setTrialEndsAt] = useState(null);

  useEffect(() => {
    let alive = true;
    getSession()
      .then(({ data }) => {
        if (alive && data.trialEndsAt) setTrialEndsAt(new Date(data.trialEndsAt));
      })
      .catch(() => {}); // si falla, simplemente no se muestra
    return () => {
      alive = false;
    };
  }, []);

  if (!trialEndsAt) return null;

  const daysLeft = Math.max(0, Math.ceil((trialEndsAt.getTime() - Date.now()) / DAY_MS));
  const soon = daysLeft <= WARN_DAYS;

  return (
    <div className={soon ? 'trial-banner trial-banner-soon' : 'trial-banner'} role="status">
      {soon ? (
        <>
          <strong>
            Tu prueba gratis vence {daysLeft <= 1 ? 'pronto' : `en ${daysLeft} días`}, el {dateLabel(trialEndsAt)}.
          </strong>{' '}
          Para seguir usando Talarix, escribinos a <a href="mailto:soporte@talarix.com.ar">soporte@talarix.com.ar</a>.
        </>
      ) : (
        <>
          Prueba gratis: vence el <strong>{dateLabel(trialEndsAt)}</strong>.
        </>
      )}
    </div>
  );
}
