import api from './axios.js';

// params: { from, to } (AAAA-MM-DD). Sin fechas, el servidor devuelve los últimos 30 días.
export const getPurchases = (params = {}) => api.get('/purchases', { params });
export const createPurchase = (data) => api.post('/purchases', data);
export const cancelPurchase = (id, reason) => api.post(`/purchases/${id}/cancel`, { reason });
