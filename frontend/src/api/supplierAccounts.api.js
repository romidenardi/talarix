import api from './axios.js';

// Cuenta corriente con proveedores
export const getSupplierBalances = () => api.get('/suppliers/balances');
// params: { from, to } (AAAA-MM-DD). Sin fechas, los últimos 30 días.
export const getSupplierStatement = (supplierId, params = {}) =>
  api.get(`/suppliers/${supplierId}/account`, { params });
export const getSupplierPayments = (params = {}) => api.get('/supplier-payments', { params });
export const createSupplierPayment = (data) => api.post('/supplier-payments', data);
export const cancelSupplierPayment = (id, reason) => api.post(`/supplier-payments/${id}/cancel`, { reason });
