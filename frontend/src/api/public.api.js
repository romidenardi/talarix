import api from './axios';

// Botones de baja y de arrepentimiento: no piden sesión.
// data: { kind: 'cancellation' | 'withdrawal', name, email, businessName?, reason?, website }
// Responde { code, kind, emailSent }
export const sendServiceRequest = (data) => api.post('/public/requests', data);
