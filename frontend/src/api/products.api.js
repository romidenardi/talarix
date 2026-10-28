import api from './axios.js';

export const getProducts = () => api.get('/products');
export const createProduct = (data) => api.post('/products', data);
export const updateProduct = (id, data) => api.put(`/products/${id}`, data);
export const deleteProduct = (id) => api.delete(`/products/${id}`);
// Variantes nuevas para un producto con variantes. items: [{ values: ['M', 'Rojo'] }]
export const addVariants = (id, items) => api.post(`/products/${id}/variants`, { items });
