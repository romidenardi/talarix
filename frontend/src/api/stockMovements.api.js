import api from './axios.js';

export const getMovementsByProduct = (productId) => api.get(`/stock-movements/product/${productId}`);

export const createStockMovement = (data) => api.post('/stock-movements', data);
