import api from './axios.js';

// kind: sin valor, los productos que se venden; 'supply', los insumos; 'all', los dos (compras)
export const getProducts = (kind) => api.get('/products', { params: kind ? { kind } : undefined });
export const createProduct = (data) => api.post('/products', data);
export const updateProduct = (id, data) => api.put(`/products/${id}`, data);
export const deleteProduct = (id) => api.delete(`/products/${id}`);
// Variantes nuevas para un producto con variantes. items: [{ values: ['M', 'Rojo'] }]
export const addVariants = (id, items) => api.post(`/products/${id}/variants`, { items });
