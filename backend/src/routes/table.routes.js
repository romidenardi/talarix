import { Router } from 'express';
import { requireRole } from '../middlewares/role.middleware.js';
import { httpError } from '../utils/httpError.js';
import { MANAGER_ROLES, CASHIER_ROLES } from '../services/table.service.js';
import {
  getSettings,
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
  getMenu,
  createMenuDish,
  updateMenuDish,
  deleteMenuDish,
  createMenuExtra,
  updateMenuExtra,
  deleteMenuExtra,
} from '../controllers/table.controller.js';

const router = Router();

// Si el comercio tiene el módulo de mesas (lo activa el superadmin, PATCH /platform/businesses/:id/modules)
router.get('/settings', getSettings);

// El resto, solo con las mesas activadas
router.use((req, res, next) => {
  if (!req.user.tablesEnabled) return next(httpError('Las mesas no están activadas para este comercio', 403));
  next();
});

// Menú: lo ven todos (el mozo elige de acá); lo cargan administrador y editor
router.get('/menu', getMenu);
router.post('/menu/dishes', requireRole(...MANAGER_ROLES), createMenuDish);
router.put('/menu/dishes/:id', requireRole(...MANAGER_ROLES), updateMenuDish);
router.delete('/menu/dishes/:id', requireRole(...MANAGER_ROLES), deleteMenuDish);
router.post('/menu/extras', requireRole(...MANAGER_ROLES), createMenuExtra);
router.put('/menu/extras/:id', requireRole(...MANAGER_ROLES), updateMenuExtra);
router.delete('/menu/extras/:id', requireRole(...MANAGER_ROLES), deleteMenuExtra);

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
