import api from './axios.js';

// Cuenta corriente de clientes (admin y editor)
export const getCustomerBalances = () => api.get('/customers/balances');
// params: { from, to } (AAAA-MM-DD). Sin fechas, los últimos 30 días.
export const getCustomerStatement = (customerId, params = {}) =>
  api.get(`/customers/${customerId}/account`, { params });
export const getCustomerPayments = (params = {}) => api.get('/customer-payments', { params });
export const createCustomerPayment = (data) => api.post('/customer-payments', data);
export const cancelCustomerPayment = (id, reason) => api.post(`/customer-payments/${id}/cancel`, { reason });
