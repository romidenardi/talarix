// Error con código HTTP. `code` es opcional: se devuelve al frontend para que reaccione a un caso
// puntual (por ejemplo APPROVAL_REQUIRED abre el pedido de autorización).
export const httpError = (message, status = 400, code) => {
  const error = new Error(message);
  error.status = status;
  if (code) error.clientCode = code;
  return error;
};
