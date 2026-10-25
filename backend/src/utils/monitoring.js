// Monitoreo de errores con Sentry (opcional). Si SENTRY_DSN no está definida, o el paquete
// @sentry/node no está instalado, no hace nada: el sistema funciona igual y los errores siguen
// yendo a los logs.
//
// Privacidad: no se envían datos personales. Se descartan el cuerpo de los pedidos, las cookies,
// los encabezados de autorización y los datos del usuario (salvo su id).
let Sentry = null;

const scrub = (event) => {
  if (event.request) {
    delete event.request.data;
    delete event.request.cookies;
    delete event.request.query_string;
    if (event.request.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.cookie;
    }
  }
  if (event.user) event.user = event.user.id ? { id: event.user.id } : undefined;
  return event;
};

export const initMonitoring = async () => {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return false;
  try {
    Sentry = await import('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      sendDefaultPii: false,
      beforeSend: scrub,
    });
    console.log('[monitoreo] Sentry activo');
    return true;
  } catch (error) {
    Sentry = null;
    console.error('[monitoreo] No se pudo iniciar Sentry:', error.message);
    return false;
  }
};

// Envía un error a Sentry con etiquetas de contexto (por ejemplo { job: 'baja' }). Nunca falla.
export const captureError = (error, tags = {}) => {
  if (!Sentry) return;
  try {
    Sentry.withScope((scope) => {
      for (const [key, value] of Object.entries(tags)) scope.setTag(key, String(value));
      Sentry.captureException(error);
    });
  } catch {
    /* el monitoreo nunca corta la aplicación */
  }
};

// Al apagar el servidor: da tiempo a que salgan los errores pendientes
export const flushMonitoring = async () => {
  if (!Sentry) return;
  try {
    await Sentry.flush(2000);
  } catch {
    /* nada */
  }
};
