import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext.jsx';
import { DialogProvider } from './context/DialogContext.jsx';
import AppRoutes from './routes/AppRoutes.jsx';

function App() {
  return (
    <BrowserRouter>
      <DialogProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </DialogProvider>
    </BrowserRouter>
  );
}

export default App;
