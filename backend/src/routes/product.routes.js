import { Router } from 'express';
import { body } from 'express-validator';
import {
  getProducts,
  getProductByBarcode,
  createProduct,
  updateProduct,
  deleteProduct,
} from '../controllers/product.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = Router();

const createRules = [
  body('internalCode').notEmpty().withMessage('El código interno es obligatorio'),
  body('name').notEmpty().withMessage('El nombre es obligatorio'),
  body('price').isFloat({ min: 0 }).withMessage('El precio debe ser un número positivo'),
  body('cost').isFloat({ min: 0 }).withMessage('El costo debe ser un número positivo'),
  body('unitType').isIn(['unit', 'weight']).withMessage('La unidad de comercialización debe ser "unidad" o "peso"'),
];

// Mismas reglas que el alta, pero cada campo es opcional: solo se valida lo que llega
const MAX_PRICE = 99999999;
const updateRules = [
  body('internalCode').optional().trim().notEmpty().withMessage('El código interno no puede quedar vacío'),
  body('name').optional().trim().notEmpty().withMessage('El nombre no puede quedar vacío'),
  body('price').optional().isFloat({ min: 0, max: MAX_PRICE }).withMessage('El precio debe ser un número positivo'),
  body('cost').optional().isFloat({ min: 0, max: MAX_PRICE }).withMessage('El costo debe ser un número positivo'),
  body('promoPrice')
    .optional({ values: 'falsy' })
    .isFloat({ min: 0, max: MAX_PRICE })
    .withMessage('El precio promocional debe ser un número positivo'),
  body('unitType')
    .optional()
    .isIn(['unit', 'weight'])
    .withMessage('La unidad de comercialización debe ser "unidad" o "peso"'),
  body('active').optional().isBoolean().withMessage('El estado no es válido'),
];

router.get('/', getProducts);
router.get('/barcode/:barcode', getProductByBarcode);
router.post('/', requireRole('admin', 'editor'), createRules, validate, createProduct);
router.put('/:id', requireRole('admin', 'editor'), updateRules, validate, updateProduct);
router.delete('/:id', requireRole('admin', 'editor'), deleteProduct);

export default router;
