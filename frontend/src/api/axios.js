import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    const isLoginRequest = error.config?.url?.includes('/auth/login');

    if (error.response?.status === 401 && !isLoginRequest) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login') {
        window.location.href = '/login';
      }
    }

    if (error.response?.status === 403 && error.response?.data?.code === 'ACCOUNT_CLOSING') {
      try {
        const raw = localStorage.getItem('user');
        if (raw) {
          const user = JSON.parse(raw);
          user.businessStatus = 'closing';
          localStorage.setItem('user', JSON.stringify(user));
        }
      } catch {
        /* sin storage */
      }
      if (window.location.pathname !== '/exportar') {
        window.location.href = '/exportar';
      }
    }

    return Promise.reject(error);
  },
);

export default api;
