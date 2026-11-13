import api from './axios.js';

export const downloadCustomerData = (id) => api.get(`/data-rights/customers/${id}/export`, { responseType: 'blob' });

// Si el cliente debe en cuenta corriente, el servidor responde 409 (code CUSTOMER_HAS_DEBT) hasta que
// se confirme con confirmDebt = true
export const anonymizeCustomer = (id, { confirmDebt = false } = {}) =>
  api.post(`/data-rights/customers/${id}/anonymize`, confirmDebt ? { confirmDebt: true } : {});
