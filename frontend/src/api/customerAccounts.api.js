import api from './axios.js';

// Cuenta corriente de clientes (admin y editor)
export const getCustomerBalances = () => api.get('/customers/balances');
// params: { from, to } (AAAA-MM-DD). Sin fechas, los últimos 30 días.
export const getCustomerStatement = (customerId, params = {}) =>
  api.get(`/customers/${customerId}/account`, { params });
export const getCustomerPayments = (params = {}) => api.get('/customer-payments', { params });
// data: { customerId, installmentIds, amount?, paymentId, date?, reference?, notes?, requestId }
export const createCustomerPayment = (data) => api.post('/customer-payments', data);
export const cancelCustomerPayment = (id, reason) => api.post(`/customer-payments/${id}/cancel`, { reason });
// Cuotas de un cliente (impagas y pagadas) y mora de todos a hoy (por tramo de atraso)
export const getCustomerInstallments = (customerId) => api.get(`/customers/${customerId}/installments`);
export const getCustomerOverdue = () => api.get('/customers/overdue');
