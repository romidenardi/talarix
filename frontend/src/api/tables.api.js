import api from './axios.js';

// Mesas y comandas (backend/src/routes/table.routes.js)
export const getTablesSettings = () => api.get('/tables/settings');
export const setTablesEnabled = (enabled) => api.put('/tables/settings', { enabled });

export const getTables = () => api.get('/tables');
export const createTable = (data) => api.post('/tables', data);
export const updateTable = (id, data) => api.put(`/tables/${id}`, data);
export const deleteTable = (id) => api.delete(`/tables/${id}`);

export const openTab = (tableId, guests) => api.post(`/tables/${tableId}/open`, { guests });
export const getTab = (tabId) => api.get(`/tables/tabs/${tabId}`);
// items: [{ productId, quantity, note }]
export const sendTicket = (tabId, items, requestId) => api.post(`/tables/tabs/${tabId}/tickets`, { items, requestId });
export const requestBill = (tabId) => api.post(`/tables/tabs/${tabId}/bill`);
export const cancelTabItem = (tabId, itemId, reason) =>
  api.post(`/tables/tabs/${tabId}/items/${itemId}/cancel`, { reason });
export const cancelTab = (tabId, reason) => api.post(`/tables/tabs/${tabId}/cancel`, { reason });
// parts: [{ paymentId, amount, tip }]
export const closeTab = (tabId, data) => api.post(`/tables/tabs/${tabId}/close`, data);

export const getKitchen = () => api.get('/tables/kitchen');
export const getTicket = (ticketId) => api.get(`/tables/tickets/${ticketId}`);
export const setTicketReady = (ticketId, ready = true) => api.post(`/tables/tickets/${ticketId}/ready`, { ready });

export const getTips = (params) => api.get('/tables/tips', { params });
