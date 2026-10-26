import api from './axios.js';

export const getOrders = () => api.get('/orders');
export const getOrder = (id) => api.get(`/orders/${id}`);
export const createOrder = (data) => api.post('/orders', data);
// Operador: autorización de un administrador o editor para descuentos y precios fuera de lista
export const approveOrder = (data) => api.post('/orders/approval', data);
export const cancelOrder = (id, reason) => api.post(`/orders/${id}/cancel`, { reason });
