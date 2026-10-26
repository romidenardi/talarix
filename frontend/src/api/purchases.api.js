import api from './axios.js';

export const getPurchases = () => api.get('/purchases');
export const createPurchase = (data) => api.post('/purchases', data);
export const cancelPurchase = (id, reason) => api.post(`/purchases/${id}/cancel`, { reason });
