import { Routes, Route } from 'react-router-dom';
import Login from '../pages/Login/Login.jsx';
import Activate from '../pages/Activate/Activate.jsx';
import ForgotPassword from '../pages/Auth/ForgotPassword.jsx';
import ResetPassword from '../pages/Auth/ResetPassword.jsx';
import Terms from '../pages/Legal/Terms.jsx';
import Privacy from '../pages/Legal/Privacy.jsx';
import ServiceRequest from '../pages/Public/ServiceRequest.jsx';
import PlatformLogin from '../pages/Platform/PlatformLogin.jsx';
import Platform from '../pages/Platform/Platform.jsx';
import Home from '../pages/Home/Home.jsx';
import Reports from '../pages/Reports/Reports.jsx';
import Categories from '../pages/Categories/Categories.jsx';
import Payments from '../pages/Payments/Payments.jsx';
import Customers from '../pages/Customers/Customers.jsx';
import Products from '../pages/Products/Products.jsx';
import Suppliers from '../pages/Suppliers/Suppliers.jsx';
import Purchases from '../pages/Purchases/Purchases.jsx';
import Supplies from '../pages/Supplies/Supplies.jsx';
import SupplierAccounts from '../pages/SupplierAccounts/SupplierAccounts.jsx';
import SupplierStatementPrint from '../pages/SupplierAccounts/SupplierStatementPrint.jsx';
import CustomerAccounts from '../pages/CustomerAccounts/CustomerAccounts.jsx';
import CustomerStatementPrint from '../pages/CustomerAccounts/CustomerStatementPrint.jsx';
import Orders from '../pages/Orders/Orders.jsx';
import OrderPrint from '../pages/Orders/OrderPrint.jsx';
import Imports from '../pages/Imports/Imports.jsx';
import Users from '../pages/Users/Users.jsx';
import ExportData from '../pages/Export/ExportData.jsx';
import Tables from '../pages/Tables/Tables.jsx';
import TicketPrint from '../pages/Tables/TicketPrint.jsx';
import NotFound from '../pages/NotFound/NotFound.jsx';
import PrivateRoute from './PrivateRoute.jsx';
import Layout from '../components/layout/Layout.jsx';

const AppRoutes = () => {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/activar" element={<Activate />} />
      <Route path="/olvide-contrasena" element={<ForgotPassword />} />
      <Route path="/restablecer" element={<ResetPassword />} />
      <Route path="/terminos" element={<Terms />} />
      <Route path="/privacidad" element={<Privacy />} />
      {/* Botones de baja y de arrepentimiento: públicos, sin ingresar */}
      <Route path="/baja" element={<ServiceRequest kind="cancellation" />} />
      <Route path="/arrepentimiento" element={<ServiceRequest kind="withdrawal" />} />
      <Route path="/plataforma/login" element={<PlatformLogin />} />
      <Route path="/plataforma" element={<Platform />} />

      <Route element={<PrivateRoute />}>
        <Route path="/orders/:id/print" element={<OrderPrint />} />
        <Route path="/mesas/comandas/:id/imprimir" element={<TicketPrint />} />
        <Route element={<PrivateRoute allowedRoles={['admin', 'editor']} />}>
          <Route path="/cuentas-proveedores/:id/imprimir" element={<SupplierStatementPrint />} />
          <Route path="/cuentas-clientes/:id/imprimir" element={<CustomerStatementPrint />} />
        </Route>

        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />

          <Route path="/orders" element={<Orders />} />
          <Route path="/purchases" element={<Purchases />} />
          <Route path="/mesas" element={<Tables />} />

          {/* La pantalla controla por sí misma que solo el administrador pueda exportar,
              porque también es la única disponible cuando el comercio está en baja */}
          <Route path="/exportar" element={<ExportData />} />

          <Route element={<PrivateRoute allowedRoles={['admin', 'editor']} />}>
            <Route path="/reports" element={<Reports />} />
            <Route path="/categories" element={<Categories />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/customers" element={<Customers />} />
            <Route path="/products" element={<Products />} />
            <Route path="/suppliers" element={<Suppliers />} />
            <Route path="/insumos" element={<Supplies />} />
            <Route path="/cuentas-proveedores" element={<SupplierAccounts />} />
            <Route path="/cuentas-clientes" element={<CustomerAccounts />} />
            <Route path="/imports" element={<Imports />} />
          </Route>

          <Route element={<PrivateRoute allowedRoles={['admin']} />}>
            <Route path="/users" element={<Users />} />
          </Route>
        </Route>
      </Route>

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default AppRoutes;
