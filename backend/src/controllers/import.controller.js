import { Product, Customer, Supplier, Category } from '../models/index.js';
import { parseSpreadsheet } from '../utils/parseSpreadsheet.js';
import { runImport } from '../services/import.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { httpError } from '../utils/httpError.js';
import { normalizeTaxId } from '../utils/taxId.js';
import {
  normalizeText, text, parseAmount, parseUnit, parseVat, parsePercent, normalizeFiscalCondition, FISCAL_CONDITIONS,
} from '../utils/importValues.js';

const MAX_PRICE = 99999999;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Busca una columna por cualquiera de sus nombres, sin importar tildes, mayúsculas ni espacios
const getField = (row, ...possibleNames) => {
  const normalizedRow = {};
  for (const key of Object.keys(row)) {
    normalizedRow[normalizeText(key).replace(/[_\s]+/g, ' ')] = row[key];
  }
  for (const name of possibleNames) {
    const value = normalizedRow[normalizeText(name)];
    if (value !== undefined && value !== null && text(value) !== '') return value;
  }
  return '';
};

const requireFile = (req) => {
  if (!req.file) throw httpError('No se recibió ningún archivo');
  return parseSpreadsheet(req.file);
};

// Mensaje para un importe que no se entiende o está fuera de rango (null si está bien)
const amountProblem = (label, value, raw) => {
  if (Number.isNaN(value)) return `${label} inválido ("${text(raw)}"): escribilo solo con números, por ejemplo 1234,50`;
  if (value < 0) return `${label} no puede ser negativo`;
  if (value > MAX_PRICE) return `${label} es demasiado grande`;
  return null;
};

// ---------------------------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------------------------
export const importProducts = asyncHandler(async (req, res) => {
  const rows = requireFile(req);
  const { businessId } = req.user;

  const existingProducts = await Product.findAll({
    where: { businessId },
    attributes: ['name', 'internalCode', 'barcode', 'scalePlu'],
  });
  const byCode = new Map();
  const byBarcode = new Map();
  const byPlu = new Map();
  for (const p of existingProducts) {
    byCode.set(normalizeText(p.internalCode), p.name);
    if (p.barcode) byBarcode.set(p.barcode, p.name);
    if (p.scalePlu) byPlu.set(Number(p.scalePlu), p.name);
  }

  const result = await runImport({
    rows,
    mapRow: (row) => {
      const raw = {
        price: getField(row, 'Precio', 'Precio de venta'),
        cost: getField(row, 'Costo'),
        unit: getField(row, 'Unidad'),
        vat: getField(row, 'IVA', 'Alícuota IVA', 'Alicuota', 'IVA %'),
        internal: getField(row, 'Impuestos Internos', 'Internos'),
      };
      return {
        raw,
        internalCode: text(getField(row, 'Código Interno', 'Codigo')),
        barcode: text(getField(row, 'Código de Barras', 'EAN')) || null,
        name: text(getField(row, 'Nombre', 'Producto')),
        brand: text(getField(row, 'Marca')) || null,
        model: text(getField(row, 'Modelo')) || null,
        description: text(getField(row, 'Descripción')) || null,
        categoryName: text(getField(row, 'Categoría', 'Rubro')),
        price: parseAmount(raw.price),
        cost: parseAmount(raw.cost) ?? 0,
        unitType: parseUnit(raw.unit),
        vatRate: parseVat(raw.vat),
        otherTaxes: parsePercent(raw.internal),
        scalePlu: text(getField(row, 'PLU Balanza', 'PLU')),
      };
    },
    textFields: [
      ['internalCode', 'El código interno'], ['barcode', 'El código de barras'], ['name', 'El nombre'],
      ['brand', 'La marca'], ['model', 'El modelo'], ['description', 'La descripción'], ['categoryName', 'La categoría'],
    ],
    validate: (d) => {
      if (!d.internalCode) return 'Falta el código interno';
      if (!d.name) return 'Falta el nombre';
      if (d.price === null) return 'Falta el precio';
      const priceProblem = amountProblem('Precio', d.price, d.raw.price) || amountProblem('Costo', d.cost, d.raw.cost);
      if (priceProblem) return priceProblem;
      if (d.unitType === null) return `Unidad desconocida ("${text(d.raw.unit)}"): usá "unidad" o "peso" (también sirven kg o kilo)`;
      if (Number.isNaN(d.vatRate)) return `IVA inválido ("${text(d.raw.vat)}"): usá 21, 10,5 o 0`;
      if (Number.isNaN(d.otherTaxes)) return `Impuestos internos inválidos ("${text(d.raw.internal)}"): tiene que ser un porcentaje entre 0 y 100`;
      if (d.scalePlu) {
        const plu = Number(d.scalePlu);
        if (!Number.isInteger(plu) || plu < 1 || plu > 9999) return 'PLU de balanza inválido (entero entre 1 y 9999)';
        if (d.unitType !== 'weight') return 'El PLU de balanza solo se usa con productos por peso (Unidad = peso)';
        d.scalePlu = plu;
      } else {
        d.scalePlu = null;
      }
      return null;
    },
    keys: [
      {
        of: (d) => normalizeText(d.internalCode),
        existing: byCode,
        onExisting: 'skip',
        inFile: 'error',
        existsMessage: (d, name) => `Ya existe el producto con código interno ${d.internalCode} ("${name}"): se dejó como estaba`,
        repeatMessage: (d, first) => `El código interno ${d.internalCode} ya está en la fila ${first}`,
      },
      {
        of: (d) => d.barcode,
        existing: byBarcode,
        onExisting: 'error',
        inFile: 'error',
        existsMessage: (d, name) => `El código de barras ${d.barcode} ya está asignado a "${name}"`,
        repeatMessage: (d, first) => `El código de barras ${d.barcode} ya está en la fila ${first}`,
      },
      {
        of: (d) => d.scalePlu,
        existing: byPlu,
        onExisting: 'error',
        inFile: 'error',
        existsMessage: (d, name) => `El PLU de balanza ${d.scalePlu} ya está asignado a "${name}"`,
        repeatMessage: (d, first) => `El PLU de balanza ${d.scalePlu} ya está en la fila ${first}`,
      },
    ],
    create: async (items, transaction) => {
      // Categorías: se buscan sin importar tildes ni mayúsculas ("Almacen" = "Almacén").
      // Las que no existen se crean, con el nombre tal como vino en la primera fila que la usa.
      const categories = await Category.findAll({ where: { businessId }, transaction });
      const categoryIds = new Map(categories.map((c) => [normalizeText(c.name), c.id]));
      const createdCategories = [];
      for (const { data } of items) {
        const key = normalizeText(data.categoryName);
        if (!key || categoryIds.has(key)) continue;
        const category = await Category.create({ businessId, name: data.categoryName }, { transaction });
        categoryIds.set(key, category.id);
        createdCategories.push(data.categoryName);
      }

      await Product.bulkCreate(items.map(({ data }) => ({
        businessId,
        internalCode: data.internalCode,
        barcode: data.barcode,
        name: data.name,
        brand: data.brand,
        model: data.model,
        description: data.description,
        categoryId: categoryIds.get(normalizeText(data.categoryName)) ?? null,
        price: data.price,
        cost: data.cost,
        vatRate: data.vatRate,
        otherTaxes: data.otherTaxes,
        unitType: data.unitType,
        scalePlu: data.scalePlu,
      })), { transaction });

      return {
        notes: createdCategories.length
          ? [`Se crearon ${createdCategories.length === 1 ? 'la categoría' : 'las categorías'}: ${createdCategories.join(', ')}`]
          : [],
      };
    },
  });

  res.json(result);
});

// ---------------------------------------------------------------------------------------------
// Clientes y proveedores: no se repiten por CUIT o, si no tienen, por nombre
// ---------------------------------------------------------------------------------------------
const digits = (value) => String(value ?? '').replace(/\D/g, '');
const identityKey = (cuit, name) => (digits(cuit) ? `cuit:${digits(cuit)}` : `nombre:${normalizeText(name)}`);
// Valida el CUIT y lo deja con formato (20-12345678-6); devuelve el mensaje si está mal
const taxIdProblem = (d) => {
  const { value, error } = normalizeTaxId(d.cuit);
  if (error) return `${error} ("${d.cuit}")`;
  d.cuit = value;
  return null;
};
const emailProblem = (email) => (email && !EMAIL_REGEX.test(email) ? `El email no es válido ("${email}")` : null);

export const importCustomers = asyncHandler(async (req, res) => {
  const rows = requireFile(req);
  const { businessId } = req.user;

  const customerName = (c) => c.businessName || [c.firstName, c.lastName].filter(Boolean).join(' ');
  const existing = new Map();
  for (const c of await Customer.findAll({ where: { businessId } })) {
    existing.set(identityKey(c.cuit, customerName(c)), customerName(c));
  }

  const result = await runImport({
    rows,
    mapRow: (row) => {
      const fiscalRaw = text(getField(row, 'Condición Fiscal', 'Condición IVA', 'IVA'));
      return {
        fiscalRaw,
        businessName: text(getField(row, 'Razón Social')) || null,
        firstName: text(getField(row, 'Nombre')) || null,
        lastName: text(getField(row, 'Apellido')) || null,
        fiscalCondition: normalizeFiscalCondition(fiscalRaw),
        cuit: text(getField(row, 'CUIT', 'CUIL', 'DNI')) || null,
        address: text(getField(row, 'Dirección', 'Domicilio')) || null,
        zipCode: text(getField(row, 'Código Postal', 'CP')) || null,
        city: text(getField(row, 'Localidad', 'Ciudad')) || null,
        province: text(getField(row, 'Provincia')) || null,
        phone: text(getField(row, 'Teléfono', 'Celular')) || null,
        email: text(getField(row, 'Email', 'Mail', 'Correo')) || null,
      };
    },
    textFields: [
      ['businessName', 'La razón social'], ['firstName', 'El nombre'], ['lastName', 'El apellido'], ['cuit', 'El CUIT'],
      ['address', 'La dirección'], ['zipCode', 'El código postal'], ['city', 'La localidad'], ['province', 'La provincia'],
      ['phone', 'El teléfono'], ['email', 'El email'],
    ],
    validate: (d) => {
      if (!d.businessName && !d.firstName) return 'Falta la razón social o el nombre';
      if (!d.fiscalRaw) return 'Falta la condición fiscal';
      if (!d.fiscalCondition) {
        return `Condición fiscal desconocida ("${d.fiscalRaw}"): usá ${FISCAL_CONDITIONS.join(', ').replace(/, ([^,]*)$/, ' o $1')}`;
      }
      return taxIdProblem(d) || emailProblem(d.email);
    },
    keys: [{
      of: (d) => identityKey(d.cuit, customerName(d)),
      existing,
      onExisting: 'skip',
      inFile: 'skip',
      existsMessage: (d, name) => `Ya existe el cliente "${name}": se dejó como estaba`,
      repeatMessage: (d, first) => `Es el mismo cliente de la fila ${first}: se importa una sola vez`,
    }],
    create: async (items, transaction) => {
      await Customer.bulkCreate(items.map(({ data }) => ({
        businessId,
        businessName: data.businessName,
        firstName: data.firstName,
        lastName: data.lastName,
        fiscalCondition: data.fiscalCondition,
        cuit: data.cuit,
        address: data.address,
        zipCode: data.zipCode,
        city: data.city,
        province: data.province,
        phone: data.phone,
        email: data.email,
      })), { transaction });
    },
  });

  res.json(result);
});

export const importSuppliers = asyncHandler(async (req, res) => {
  const rows = requireFile(req);
  const { businessId } = req.user;

  const existing = new Map();
  for (const s of await Supplier.findAll({ where: { businessId }, attributes: ['name', 'cuit'] })) {
    existing.set(identityKey(s.cuit, s.name), s.name);
  }

  const result = await runImport({
    rows,
    mapRow: (row) => ({
      name: text(getField(row, 'Nombre', 'Razón Social', 'Proveedor')),
      cuit: text(getField(row, 'CUIT')) || null,
      contactPerson: text(getField(row, 'Contacto')) || null,
      phone: text(getField(row, 'Teléfono', 'Celular')) || null,
      email: text(getField(row, 'Email', 'Mail', 'Correo')) || null,
      address: text(getField(row, 'Dirección', 'Domicilio')) || null,
      city: text(getField(row, 'Localidad', 'Ciudad')) || null,
      province: text(getField(row, 'Provincia')) || null,
    }),
    textFields: [
      ['name', 'El nombre'], ['cuit', 'El CUIT'], ['contactPerson', 'El contacto'], ['phone', 'El teléfono'],
      ['email', 'El email'], ['address', 'La dirección'], ['city', 'La localidad'], ['province', 'La provincia'],
    ],
    validate: (d) => (d.name ? taxIdProblem(d) || emailProblem(d.email) : 'Falta el nombre'),
    keys: [{
      of: (d) => identityKey(d.cuit, d.name),
      existing,
      onExisting: 'skip',
      inFile: 'skip',
      existsMessage: (d, name) => `Ya existe el proveedor "${name}": se dejó como estaba`,
      repeatMessage: (d, first) => `Es el mismo proveedor de la fila ${first}: se importa una sola vez`,
    }],
    create: async (items, transaction) => {
      await Supplier.bulkCreate(items.map(({ data }) => ({ businessId, ...data })), { transaction });
    },
  });

  res.json(result);
});
