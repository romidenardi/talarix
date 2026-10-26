import api from './axios.js';

export const downloadCustomerData = (id) => api.get(`/data-rights/customers/${id}/export`, { responseType: 'blob' });

export const anonymizeCustomer = (id) => api.post(`/data-rights/customers/${id}/anonymize`);
