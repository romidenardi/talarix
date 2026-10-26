import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import { DialogProvider } from './context/DialogContext.jsx';
import AppRoutes from './routes/AppRoutes.jsx';

function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <DialogProvider>
          <AuthProvider>
            <AppRoutes />
          </AuthProvider>
        </DialogProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

export default App;