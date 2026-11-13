import api from './axios';

export const getDashboard = () => api.get('/reports/dashboard');
export const getSalesSummary = (params) => api.get('/reports/sales-summary', { params });
export const getSalesByProduct = (params) => api.get('/reports/sales-by-product', { params });
export const getSalesByCustomer = (params) => api.get('/reports/sales-by-customer', { params });
export const getSalesByPayment = (params) => api.get('/reports/sales-by-payment', { params });
export const getVatReport = (params) => api.get('/reports/vat', { params });
export const getPurchaseVatReport = (params) => api.get('/reports/purchase-vat', { params });
export const getExpensesReport = (params) => api.get('/reports/expenses', { params });
export const getVatPosition = (params) => api.get('/reports/vat-position', { params });
