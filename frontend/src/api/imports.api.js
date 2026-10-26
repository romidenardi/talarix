import api from './axios.js';

const uploadFile = (endpoint, file) => {
  const formData = new FormData();
  formData.append('file', file);
  return api.post(endpoint, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  });
};

export const importProducts = (file) => uploadFile('/imports/products', file);
export const importCustomers = (file) => uploadFile('/imports/customers', file);
export const importSuppliers = (file) => uploadFile('/imports/suppliers', file);
