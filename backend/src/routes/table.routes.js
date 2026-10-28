import { Router } from 'express';
import { requireRole } from '../middlewares/role.middleware.js';
import { httpError } from '../utils/httpError.js';
import { MANAGER_ROLES, CASHIER_ROLES } from '../services/table.service.js';
import {
  getSettings,
  updateSettings,
  getTables,
  createTable,
  updateTable,
  deleteTable,
  openTableTab,
  getTableTab,
  createTicket,
  getKitchenTicket,
  getKitchen,
  setTicketReady,
  cancelTabItem,
  askForBill,
  cancelTableTab,
  closeTableTab,
  getTips,
} from '../controllers/table.controller.js';

const router = Router();

// El administrador activa las mesas para su comercio
router.get('/settings', getSettings);
router.put('/settings', requireRole('admin'), updateSettings);

// El resto, solo con las mesas activadas
router.use((req, res, next) => {
  if (!req.user.tablesEnabled) return next(httpError('Las mesas no están activadas para este comercio', 403));
  next();
});

router.get('/', getTables);
router.post('/', requireRole(...MANAGER_ROLES), createTable);
router.put('/:id', requireRole(...MANAGER_ROLES), updateTable);
router.delete('/:id', requireRole(...MANAGER_ROLES), deleteTable);

router.get('/kitchen', getKitchen);
router.get('/tickets/:ticketId', getKitchenTicket);
router.post('/tickets/:ticketId/ready', setTicketReady);

router.get('/tips', requireRole(...MANAGER_ROLES), getTips);

router.post('/:id/open', openTableTab);
router.get('/tabs/:tabId', getTableTab);
router.post('/tabs/:tabId/tickets', createTicket);
router.post('/tabs/:tabId/bill', askForBill);
router.post('/tabs/:tabId/items/:itemId/cancel', requireRole(...MANAGER_ROLES), cancelTabItem);
router.post('/tabs/:tabId/cancel', requireRole(...MANAGER_ROLES), cancelTableTab);
router.post('/tabs/:tabId/close', requireRole(...CASHIER_ROLES), closeTableTab);

export default router;
