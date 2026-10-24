const FIELD_LABELS = {
  internalCode: 'código interno',
  barcode: 'código de barras',
  name: 'nombre',
  price: 'precio',
  cost: 'costo',
  vatRate: 'alícuota de IVA',
  email: 'email',
  businessName: 'razón social',
  firstName: 'nombre',
  cuit: 'CUIT',
  lastName: 'apellido',
  address: 'dirección',
  city: 'ciudad',
  province: 'provincia',
  phone: 'teléfono',
  notes: 'notas',
  description: 'descripción',
  brand: 'marca',
  model: 'modelo',
  invoiceNumber: 'número de factura',
  reason: 'motivo',
};

const fieldLabel = (path) => FIELD_LABELS[path] || path;

const duplicateMessage = (err) => {
  const detail = `${err.original?.sqlMessage || ''} ${err.parent?.sqlMessage || ''} ${err.errors?.[0]?.path || ''}`;
  if (detail.includes('barcode')) {
    return 'Ese código de barras ya está asignado a otro producto';
  }
  return 'Ya existe un registro con esos datos';
};

// Errores de la base que son culpa del dato enviado, no del servidor (códigos de MySQL)
const DATA_ERRORS = {
  ER_DATA_TOO_LONG: (err) => {
    const column = /column '([^']+)'/.exec(err.original?.sqlMessage || '')?.[1];
    return `El texto es demasiado largo${column ? ` (${fieldLabel(toCamel(column))})` : ''}. Acortalo y probá de nuevo.`;
  },
  ER_WARN_DATA_OUT_OF_RANGE: () => 'Uno de los números es demasiado grande.',
  ER_TRUNCATED_WRONG_VALUE: () => 'Uno de los datos no tiene el formato correcto.',
  ER_TRUNCATED_WRONG_VALUE_FOR_FIELD: () => 'Uno de los datos no tiene el formato correcto.',
};

const toCamel = (column) => column.replace(/_([a-z])/g, (_, c) => c.toUpperCase());

// Lo que se guarda en los logs: sin el error completo, porque los de Sequelize traen la consulta SQL
// con los valores (emails, nombres, CUIT) y los logs de Railway los vería cualquiera con acceso.
const logError = (err, req) => {
  const where = `${req.method} ${req.originalUrl.split('?')[0]}`;
  if (err.name?.startsWith('Sequelize')) {
    // El texto de MySQL solo para los errores de formato ("Data too long for column 'notes'"): el de
    // un duplicado ("Duplicate entry 'mail@...'") trae el valor.
    const code = err.original?.code || '';
    const detail = DATA_ERRORS[code] ? err.original?.sqlMessage : '';
    console.error(`[error] ${where} · ${err.name} · ${code} ${detail || ''}`.trim());
  } else if ((err.status || 500) >= 500) {
    console.error(`[error] ${where} ·`, err.stack || err.message);
  }
};

export const errorMiddleware = (err, req, res, next) => {
  logError(err, req);

  if (err.name === 'SequelizeUniqueConstraintError') {
    return res.status(409).json({ message: duplicateMessage(err) });
  }

  // Respaldo de los chequeos de los controladores: la base rechazó borrar algo que tiene historial
  if (err.name === 'SequelizeForeignKeyConstraintError') {
    return res.status(409).json({
      message: 'No se puede eliminar porque tiene remitos o compras asociados. Podés marcarlo como inactivo.',
    });
  }

  if (err.name === 'SequelizeValidationError') {
    const details = (err.errors || []).map((e) => e.message);
    const fields = [...new Set((err.errors || []).map((e) => e.path).filter(Boolean))].map(fieldLabel);
    return res.status(400).json({
      message: fields.length
        ? `Revisá estos datos: ${fields.join(', ')}`
        : 'Error de validación',
      errors: details,
    });
  }

  if (err.name === 'SequelizeDatabaseError' && DATA_ERRORS[err.original?.code]) {
    return res.status(400).json({ message: DATA_ERRORS[err.original.code](err) });
  }

  if (err.name === 'MulterError') {
    const messages = {
      LIMIT_FILE_SIZE: 'El archivo supera los 5 MB. Dividilo en archivos más chicos.',
      LIMIT_FILE_COUNT: 'Subí un solo archivo por vez.',
      LIMIT_UNEXPECTED_FILE: 'Subí un solo archivo por vez.',
    };
    return res.status(400).json({ message: messages[err.code] || 'No se pudo recibir el archivo' });
  }

  const status = err.status || 500;
  const isInternal = status >= 500 && process.env.NODE_ENV === 'production';
  res.status(status).json({
    message: isInternal ? 'Error interno del servidor' : err.message || 'Error interno del servidor',
  });
};