import { useEffect, useState } from 'react';

// Lee el token de los links de los mails (?token=...) y lo saca de la barra de direcciones apenas
// se leyó: así no queda en el historial del navegador ni se puede ver por encima del hombro.
// Si la persona recarga la página, el link ya no está: tiene que volver a abrirlo desde el mail.
export const useUrlToken = () => {
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token') || '');

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('token')) {
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
  }, []);

  return token;
};
