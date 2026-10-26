import { Router } from 'express';
import { body } from 'express-validator';
import { getCategories, createCategory, updateCategory, deleteCategory } from '../controllers/category.controller.js';
import { validate } from '../middlewares/validate.middleware.js';
import { requireRole } from '../middlewares/role.middleware.js';

const router = Router();

const createRules = [body('name').notEmpty().withMessage('El nombre es obligatorio')];

const updateRules = [body('name').optional().notEmpty().withMessage('El nombre no puede quedar vacío')];

router.get('/', getCategories);
router.post('/', requireRole('admin', 'editor'), createRules, validate, createCategory);
router.put('/:id', requireRole('admin', 'editor'), updateRules, validate, updateCategory);
router.delete('/:id', requireRole('admin', 'editor'), deleteCategory);

export default router;
