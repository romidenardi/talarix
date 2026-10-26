import api from './axios.js';

export const loginRequest = (email, password) => api.post('/auth/login', { email, password });

export const forgotPassword = (email) => api.post('/auth/forgot-password', { email });

export const resetPassword = (token, password) => api.post('/auth/reset-password', { token, password });
