# Talarix: Backend

API de gestión para pequeños comercios (stock, clientes, proveedores, compras, remitos, formas de pago, cuotas, descuentos, IVA, combos y productos por peso con balanza). Multi-comercio: una sola base de datos, con los datos de cada comercio separados por `businessId`.

**Stack:** Node.js, Express 5, Sequelize, MySQL, JWT, Nodemailer, node-cron, qrcode, xlsx (SheetJS 0.20.3, instalado desde el CDN oficial). Desplegado en Railway.

## Entornos

| Entorno | Rama | Backend | Frontend |
|---|---|---|---|
| Producción | `main` | Railway (production) | Vercel (production) |
| Staging | `staging` | Railway (staging, base propia) | Vercel (preview de la rama `staging`) |

Dominios de producción: `app.talarix.com.ar` (frontend, Vercel) y `api.talarix.com.ar` (backend, Railway).

Los cambios se prueban primero en `staging` y después se pasan a `main` (ver "Flujo de trabajo").

## Requisitos
- Node.js 22 o superior (es la que usa GitHub Actions).
- MySQL local, o acceso a una base de desarrollo.

## Puesta en marcha local
```bash
npm install
cp .env.example .env   # si no existe, crear .env con las variables de abajo
npm run dev            # nodemon server.js
```

**Base local desde cero** (lo más simple si la base local quedó atrasada respecto de staging y producción):
1. En el cliente de MySQL: `DROP DATABASE <DB_NAME>;` y `CREATE DATABASE <DB_NAME>;`.
2. `npm run dev`: en una base vacía crea todas las tablas con sus columnas actuales (ver "Cambios en la base de datos").
3. Crear el superadmin con `scripts/createPlatformAdmin.js` (ver "Superadmin") y un comercio desde `/plataforma`.

Una base local anterior a las migraciones necesita los cambios del "Historial de cambios manuales"; si le faltan, la app falla al usar esas columnas. Lo más simple es crearla de cero.

| Script | Qué hace |
|---|---|
| `npm run dev` | Arranca con recarga automática (nodemon) |
| `npm start` | Arranca para producción (`node server.js`) |
| `npm test` | Pruebas unitarias (no necesitan base de datos) |
| `npm run test:integration` | Pruebas de la API contra una base MySQL de pruebas (ver "Tests") |
| `npm run lint` | Revisión de código con ESLint (reglas recomendadas): variables sin declarar o sin usar, código que no se ejecuta… |
| `npm run format` | Ordena el formato de todo el código con Prettier (`npm run format:check` solo revisa) |

Al iniciar, el servidor valida las variables obligatorias, verifica que `JWT_SECRET` y `PLATFORM_JWT_SECRET` sean distintas, activa Sentry si está configurado, avisa si `DB_HOST` no es la red privada de Railway, se conecta a MySQL, aplica las migraciones pendientes (ver "Cambios en la base de datos") y, una vez escuchando, arranca las tareas programadas (bajas, vencimiento de pruebas y reinicio de la demo). Al recibir `SIGTERM` (Railway lo manda en cada deploy) se cierra en orden: deja de aceptar pedidos, termina los que están en curso (hasta 10 s), para las tareas y cierra la conexión con la base.

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Sí | Conexión a MySQL. `DB_HOST` es la dirección interna de Railway. La app usa el usuario `talarix_app`, no `root` (ver "Credenciales y rotación de claves") |
| `JWT_SECRET` | Sí | Firma de los tokens de usuarios (8 h) |
| `PLATFORM_JWT_SECRET` | Sí | Firma de los tokens del superadmin (2 h). Debe ser **distinta** de `JWT_SECRET` |
| `APP_URL` | Sí | URL pública del frontend, sin barra final. Se usa en los links de los mails (activación, restablecer contraseña) |
| `CORS_ORIGIN` | Sí en la práctica | Origen(es) permitido(s) del frontend, separados por coma y sin barra final. Si está vacío, el navegador no puede llamar a la API |
| `PORT` | No | Puerto del servidor (por defecto 3000; Railway lo define solo) |
| `NODE_ENV` | No | `production` en Railway (oculta detalles de errores) |
| `DEMO_RESET_ENABLED` | No | `false` desactiva el reinicio nocturno de la demo. En staging y local va en `false`; en producción no se carga (o `true`), porque los términos prometen el reinicio |
| `SUPPORT_EMAIL` | Recomendada | Casilla de consultas que figura en los mails de baja. Valor actual: `hola@talarix.com.ar`. Cargarla en **ambos** entornos de Railway |
| `DISABLE_AUTO_PURGE` | No | `true` desactiva el borrado automático de comercios dados de baja (ver "Baja de comercios") |
| `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASS`, `MAIL_FROM` | No | Envío de mails por SMTP (ver "Mails") |
| `MAIL_SECURE` | No | `true` o `false`. Por defecto es `true` solo con el puerto 465 |
| `SENTRY_DSN` | Recomendada | Monitoreo de errores (ver "Monitoreo"). Sin ella, los errores van solo a los logs |
| `SENTRY_ENVIRONMENT` | No | Nombre del entorno en Sentry: `production` o `staging`. Si no está, usa `NODE_ENV` |
| `TEST_DB_NAME` | No | Solo para `npm run test:integration`: base de pruebas (por defecto `talarix_test`; tiene que terminar en `_test`) |

En Railway, los `DB_*` se cargan como referencias a la base del propio entorno, por ejemplo `${{MySQL.MYSQLHOST}}`. Nunca uses los secretos de producción en staging.

## Estructura
```
server.js          arranque: valida variables, Sentry, conecta, migraciones, listen, tareas y cierre ordenado
migrations/        cambios de base numerados (001-….sql), se aplican solos al arrancar
test/unit/         pruebas unitarias (node --test)
test/integration/  pruebas de la API contra MySQL
../.github/workflows/ci.yml   integración continua en GitHub Actions
src/
  app.js           Express: middlewares globales y montaje de rutas
  config/          conexión a la base (database.js)
  db/              migraciones (migrations.js)
  controllers/     arman la respuesta de cada ruta; la lógica pesada está en
                   services/ (por ejemplo, order.service.js crea los remitos)
  routes/          definición de rutas
  models/          modelos Sequelize
  middlewares/     auth, roles, demo, errores
  reports/         un archivo por reporte (resumen, por producto, por cliente,
                   por forma de pago, IVA, inicio) y common.js con lo compartido
  services/        servicios: creación de remitos (order.service.js),
                   movimientos de stock (stock.service.js), cálculo
                   del remito (orderPricing.js), número de remito
                   (orderNumber.service.js), autorización de descuentos,
                   variantes de productos (variant.service.js), mesas y
                   comandas (table.service.js),
                   importación, datos de la cuenta demo, exportación a Excel,
                   borrado de un comercio, programador de bajas y vencimiento
                   de pruebas (trialExpiry.service.js)
  jobs/            tareas programadas (reinicio nocturno de la demo)
  utils/           ayudas: fechas en hora argentina (dates.js), asyncHandler,
                   httpError, números y cantidades
                   (numbers.js), getter de columnas decimales
                   (decimalColumn.js), formato de etiquetas de balanza
                   (scaleConfig.js), CUIT (taxId.js), contraseñas, tokens
                   de invitación, versión de términos, mails y links de
                   acceso, registro de actividad (audit.js), Sentry
                   (monitoring.js), límite de tareas pesadas (gate.js) y
                   control de la dirección de la base (dbHost.js)
scripts/           operación: crear superadmin, desactivar su segundo factor,
                   migraciones (migrate.js)
```

## API

Todas las rutas cuelgan de `/api`. Salvo `auth` y `platform`, exigen token de usuario.

| Ruta | Acceso | Qué hace |
|---|---|---|
| `/auth/login`, `/auth/activate` | pública | Ingreso y activación de cuenta con aceptación de términos |
| `/auth/forgot-password`, `/auth/reset-password` | pública | Recuperar contraseña por mail |
| `/platform/login`, `/platform/login/mfa*` | pública | Ingreso del superadmin en dos pasos (contraseña y código de Google Authenticator) |
| `/platform/*` | superadmin | Alta de comercios, estado, prueba gratis, reinvitar, reiniciar demo |
| `/platform/audit` | superadmin | Registro de actividad (`?limit=` hasta 500, `?businessId=`) |
| `/platform/businesses/:id/trial` | superadmin | `PATCH { until: 'AAAA-MM-DD' }` renueva la prueba hasta ese día; `{ until: null }`, sin vencimiento. Reactiva al comercio si estaba suspendido por la prueba |
| `/platform/businesses/:id/closure` | superadmin | `POST` inicia la baja (pide el nombre exacto del comercio en `confirmName`); `DELETE` la cancela |
| `/categories`, `/products`, `/stock-movements` | autenticados | Catálogo y movimientos de stock |
| `/combos` | autenticados | Combos de productos |
| `/scale-config` | `GET`: autenticados; `PUT`: `admin`, `editor` | Formato de las etiquetas de la balanza del comercio |
| `/payments`, `/customers`, `/suppliers` | autenticados | Formas de pago (cuotas y descuentos), clientes, proveedores |
| `/purchases`, `/orders` | autenticados | Compras y remitos |
| `/orders/:id/cancel` | `admin`, `editor` | Anula un remito y devuelve el stock |
| `/purchases/:id/cancel` | `admin`, `editor` | Anula una compra y resta del stock lo que había sumado |
| `/orders/approval` | `operador` | Autorización de un admin o editor (su email y contraseña) para un remito con descuento o precio fuera de lista |
| `/reports/*` | `admin`, `editor` | Panel de inicio y reportes (ventas, productos, clientes, formas de pago, IVA) |
| `/imports` | `admin`, `editor` | Importación desde Excel (bloqueada en demo) |
| `/users` | `admin` | Usuarios del comercio (bloqueada en demo) |
| `/export` | `admin` | Descarga de todos los datos del comercio en un Excel. **Única ruta disponible durante la baja** |
| `/tables/*` | autenticados, con el módulo de mesas | Mesas y comandas (ver "Mesas y comandas"). `GET /tables/settings` dice si el comercio tiene el módulo |
| `/platform/businesses/:id/modules` | superadmin | `PATCH { tables: true \| false }` activa o quita el módulo de mesas. No borra datos |
| `/data-rights/customers/:id/export` | `admin` | Exporta los datos de un cliente (pedido de acceso) |
| `/data-rights/customers/:id/anonymize` | `admin` | Anonimiza a un cliente (pedido de supresión), conservando sus remitos |

Detalles que conviene saber:
- Los precios incluyen IVA. `Order.total` es el final, después de descuentos; las cuotas son informativas.
- Los remitos anulados (`status = 'cancelled'`) quedan en el historial y se excluyen de los reportes.
- **Listados por fecha:** `GET /orders` y `GET /purchases` devuelven solo un período: `?from=AAAA-MM-DD&to=AAAA-MM-DD` (días argentinos, hasta 366 días). Sin fechas, los últimos 30 días. Fechas mal escritas o un rango más largo responden `400`. Usa `readRange` de `utils/dates.js`, lo mismo que los reportes.
- **Reportes** (`src/reports/`): las sumas se hacen en la base (`SUM` / `GROUP BY` por día, producto, cliente, forma de pago o alícuota), así que al servidor llegan pocos renglones aunque el período tenga miles de remitos. El día de cada remito se calcula en hora argentina dentro de la consulta. Los descuentos del remito se reparten entre sus renglones (total / bruto). En el de IVA, los renglones comunes se suman por alícuota en la base; los combos se reparten entre sus productos en el servidor, con los datos guardados al vender.
- **Exportación completa** (`/export`): el Excel se arma entero en memoria, así que se permiten **dos a la vez en todo el servidor y una por comercio** (`utils/gate.js`); si no hay lugar responde `429` ("Ya hay una exportación en curso"). Además, 5 por hora por usuario.
- **Clientes y proveedores:** la condición fiscal tiene que ser una de las cuatro (`Consumidor Final`, `Responsable Inscripto`, `Monotributista`, `Exento`; se aceptan variantes como "RI" o minúsculas y se guarda bien escrita). El CUIT se valida con su dígito verificador y se guarda como `20-12345678-6`; también se acepta un DNI de 7 u 8 números (`utils/taxId.js`, el mismo archivo que en el frontend). Al editar, si el CUIT viene igual al que ya tenía, no se revisa, para no trabar clientes cargados antes de esta validación. La importación aplica las mismas reglas.
- **Número de remito** (`orders.number`): correlativo por comercio (1, 2, 3…), se muestra como `00000123`. Lo asigna `services/orderNumber.service.js` bloqueando la fila del comercio, y el índice único `uq_orders_business_number` impide repetidos. Los anulados conservan su número.
- **Stock: un solo lugar** (`services/stock.service.js`). Remitos, anulaciones, compras, ajustes manuales y datos demo cambian el stock solo con `moveStock`, que deja el movimiento, guarda quién lo hizo y no deja el stock negativo. Los productos se bloquean con `lockProducts`, **siempre ordenados por id**: dos ventas simultáneas con los mismos productos en distinto orden se esperan en lugar de trabarse (deadlock).
- **Quién hizo cada cosa:** remitos, compras y movimientos de stock guardan `created_by_id` y `created_by_name` (el nombre queda aunque después se borre el usuario). La anulación guarda además `cancelled_by_id`.
- **Compras:**
  - **Anular** (`POST /purchases/:id/cancel`, admin y editor): resta del stock lo que la compra había sumado y la deja marcada (`status = 'cancelled'`, con quién y por qué). Si ya no hay stock suficiente (se vendió parte), responde `409` y se corrige con un ajuste de stock. El costo de los productos no cambia. Para corregir una compra mal cargada: anularla y cargarla de nuevo.
  - **Factura repetida:** si el mismo proveedor ya tiene una compra activa con ese número de factura (comparando sin espacios, guiones ni mayúsculas), responde `409` con `code: 'DUPLICATE_INVOICE'`. El frontend pregunta y, si el usuario confirma, reenvía con `confirmDuplicateInvoice: true`.
  - **Costo del producto:** queda el promedio ponderado de los renglones de esa compra. Una compra a costo 0 (bonificada) no pisa el costo anterior.
  - **Fecha:** opcional; no puede ser futura ni de hace más de un año.
  - No se pueden comprar combos (no tienen stock propio).
- **Cálculo del remito** (`services/orderPricing.js`, función pura con pruebas): el precio unitario se redondea a centavos antes de calcular, cada renglón se redondea y el total es la suma de los renglones, así el remito impreso siempre cierra (10,333 × 3 → 10,33 → 30,99). Lo usan los remitos reales y los datos demo.
- **IVA del momento de la venta:** cada renglón guarda `vat_rate` y `other_taxes` (los combos, dentro de `components`). El reporte de IVA usa esos, así que cambiar después el IVA de un producto no mueve las ventas ya hechas. Los renglones anteriores a la columna se completaron con el IVA que tenía el producto al migrar.
- **No se venden productos ni formas de pago inactivos:** el remito responde `400` (el frontend tampoco los ofrece).
- **Descuentos del operador:** el `operador` vende al precio de lista o al precio promocional del producto, sin descuentos. Para otra cosa, un `admin` o `editor` del comercio escribe su email y contraseña en la pantalla de Remitos: `POST /orders/approval` devuelve un token de 10 minutos que vale solo para ese remito (su `requestId`), esos descuentos y esos precios. `POST /orders` lo revisa; si falta, venció o el remito cambió, responde `403` con `code: 'APPROVAL_REQUIRED'` y el frontend vuelve a pedir la autorización. Límite: 5 intentos fallidos cada 15 minutos por operador. Queda en el registro de actividad (`order.approved` con quién autorizó, y `order.approval_failed`). Lógica en `services/orderApproval.service.js`.
- `httpError(mensaje, status, code)`: el `code` opcional llega al frontend en la respuesta (por ejemplo `APPROVAL_REQUIRED`).
- El código de barras de un producto es opcional y **único por comercio**. Los vacíos se guardan como `NULL`.
- Los errores de unicidad responden `409` con un mensaje en castellano.
- **Nada con historial se borra:** un cliente con remitos, un proveedor con compras, un producto vendido o comprado, un combo vendido o una forma de pago usada responden `409` con un mensaje que propone la alternativa (anonimizar al cliente, o marcar inactivo el proveedor o el producto). En la base, esas claves foráneas son `ON DELETE RESTRICT`. Los movimientos de stock sí se borran junto con un producto que nunca se usó.
- **Ediciones:** cada controlador acepta solo los campos permitidos (`pick` de `utils/pick.js`). El stock y el `businessId` no se pueden cambiar desde la API; la categoría de un producto o de un combo y la categoría padre se verifican contra el comercio.
- **Sin remitos ni compras duplicados:** el frontend manda un `requestId` (UUID) con cada remito y cada compra, y deshabilita el botón mientras envía. Si el mismo `requestId` llega dos veces (doble clic, reintento por un corte de red), el servidor responde `200` con el remito o la compra que ya creó, en lugar de crear otro. Es único por comercio (`uq_orders_business_request`, `uq_purchases_business_request`).
- Los errores de validación responden `400` con `message` (el primero, para mostrar) y `errors` (la lista completa).
- Un texto más largo que su columna, un número demasiado grande o un dato con formato incorrecto responden `400` con un mensaje en castellano (por ejemplo, "El texto es demasiado largo (notas)"), en lugar de `500`. Lo resuelve `error.middleware.js` con el código de error de MySQL.
- **Logs de errores:** `error.middleware.js` no vuelca el error completo, porque los de Sequelize traen la consulta con los valores (emails, nombres, CUIT). Registra el método, la ruta y el código de MySQL; los errores propios de validación (`4xx`) no se registran.
- **Productos por peso:** `unitType = 'weight'`. Su precio, costo y promo son **por kg** y las cantidades están en kg con hasta 3 decimales. Los productos por unidad solo admiten cantidades enteras (lo valida el servidor).
- Stock y cantidades (`products.stock`, `order_items`, `purchase_items`, `stock_movements`) son `DECIMAL(12,3)`. Sequelize devuelve los DECIMAL como texto: los modelos usan `numericGetter` (`utils/decimalColumn.js`) para que lleguen como número, y las cuentas con cantidades se redondean con `round3`.
- **Balanza:** cada producto por peso puede tener un `scalePlu` (1 a 9999), único por comercio. El comercio guarda en `businesses.scale_config` cómo se arma la etiqueta EAN-13 (prefijo, posición del PLU y del valor, si trae peso o importe, decimales, dígito de control). El valor de fábrica es el de Systel. La etiqueta se interpreta en el frontend; el backend solo guarda la configuración.
- Los combos siguen usando cantidades enteras y no admiten productos por peso (se filtra en el frontend).
- **Productos con variantes** (`services/variant.service.js`, migración `002`): cada variante (talle, color…) es un producto más, con su código, código de barras, stock y costo, así remitos, compras, stock, combos y reportes no cambian. La agrupa un **producto principal** (`variant_attributes`, hasta 3 atributos) que no se vende, no se compra ni tiene stock: remitos, compras, movimientos de stock y combos responden `400` si se lo elige. Cada variante guarda `parent_id` y `variant_values` (en el orden de los atributos), y su nombre se arma solo (`Remera · M / Rojo`).
  - `POST /products` con `variants: { attributes, items: [{ values, internalCode?, barcode?, price? }] }` crea el principal y sus variantes en una transacción (hasta 100; código por defecto `CÓDIGO-1`, `-2`…). `POST /products/:id/variants` agrega combinaciones nuevas. Una combinación repetida (sin importar mayúsculas) responde `409`.
  - Editar el principal pasa a las variantes la categoría, el IVA, los impuestos internos, la marca, el modelo, la descripción, el nombre y el estado; el precio y la promo solo a las que no tienen precio propio (`own_price`), y el costo solo a las que todavía tenían el mismo. Se pueden renombrar los atributos, pero no agregar ni quitar.
  - En una variante se cambian el código, el código de barras, el precio (queda `own_price = 1`; con `ownPrice: false` vuelve al del principal), el costo, el estado y sus valores. No se activa si el principal está inactivo.
  - Solo productos por unidad. Borrar el principal borra sus variantes, salvo que alguna tenga historial o esté en un combo. La importación desde Excel crea productos sin variantes.
- **Importación:** hasta 5 MB y 5.000 filas por archivo, solo la primera hoja. Además del filtro por extensión, `utils/parseSpreadsheet.js` revisa que el contenido coincida (un .xlsx tiene que ser un ZIP; un .csv, texto) y responde `400` con un mensaje claro si el archivo no se puede leer.
- **Importación: todo o nada** (`services/import.service.js`). Primero se revisan todas las filas; si alguna tiene un error, no se guarda ninguna y se devuelve la lista (`imported: false`, `errors: [{ row, message }]`). Si están todas bien, se guardan juntas en una transacción.
- **Sin duplicados:** las filas que ya existen se saltean y se informan en `skipped` (productos por código interno; clientes y proveedores por CUIT o, sin CUIT, por nombre). Subir dos veces el mismo archivo no duplica nada. Un código de barras o un PLU que ya usa otro producto es un error. Un producto existente **no se modifica** desde la importación.
- **Valores** (`utils/importValues.js`): precios con coma o punto decimal (`1234,50`, `1.234,50`, `1234.50`; `1.234` es mil doscientos treinta y cuatro); Unidad `unidad`/`peso` y también `kg`, `kilo`, `granel`; IVA `21`, `10,5` o `0` (vacío = 21, y también `21%` o el formato porcentaje de Excel); columna opcional `Impuestos Internos`; condición fiscal con variantes (`CF`, `RI`, `Monotributo`…). Las columnas se reconocen sin importar tildes ni mayúsculas. Los CSV se leen como texto (`raw: true`) para que "1,500" no se convierta en 1500.
- **Categorías:** se buscan sin importar tildes ni mayúsculas ("almacen" = "Almacén"); las que no existen se crean y se informan en `notes`.
- La importación acepta la columna opcional `PLU Balanza` (solo con `Unidad = peso`); en productos por peso, Precio y Costo son por kg. El precio es obligatorio; el costo vacío queda en 0.

## Tests
Se usa el corredor de pruebas que viene con Node (`node --test`): no hay librerías extra.

- **Unitarias** (`npm test`, en `test/unit/`): números y cantidades, fechas, cálculo del remito, IVA e impuestos internos (también de combos), valores de importación, CUIT y contraseñas, configuración de la balanza (la lectura de etiquetas se prueba en el frontend), migraciones, variantes de productos, `gate.js` y `dbHost.js`. También controlan que el frontend calcule igual que el backend (IVA, CUIT, contraseñas). No necesitan base.
- **Integración** (`npm run test:integration`, en `test/integration/`): levantan la API de verdad contra MySQL y prueban remitos (crear, stock, peso, doble envío, falta de stock, anular), la autorización de descuentos del operador, productos y formas de pago inactivos, aislamiento entre comercios, borrado de productos con ventas, compras, clientes, usuarios, importación, migraciones, los listados por fecha, los reportes (con importes esperados exactos) el vencimiento y la renovación de la prueba gratis, los productos con variantes, y las mesas y comandas (con el rol mozo).
  - La base de pruebas se arma igual que una base nueva en producción: `runMigrations` (con `sync` y las migraciones marcadas).
  - **Borran y crean de nuevo la base `talarix_test`** (o la de `TEST_DB_NAME`) en cada corrida. Por seguridad, el nombre tiene que terminar en `_test`: no pueden tocar la base de trabajo.
  - En local usan `DB_HOST`, `DB_PORT`, `DB_USER` y `DB_PASSWORD` del `.env`. El usuario tiene que poder crear bases (con `root` local alcanza).
- **GitHub Actions** (`.github/workflows/ci.yml`, en la raíz del repo): en cada push a `staging` o `main` corre las dos clases de pruebas con un MySQL propio, `npm audit` (falla con vulnerabilidades altas o críticas) y la compilación del frontend. El resultado se ve en la pestaña **Actions** del repo y al lado de cada commit (✓ o ✗).

Al agregar algo que mueve stock o plata, sumar su prueba. Antes de hacer el merge a `main`, el último commit de `staging` tiene que estar en verde.

## Monitoreo
- **`GET /health`**: responde `{"status":"ok"}` si el servidor anda y llega a la base, o `503` si no. No pide token ni devuelve datos. En Railway se configura en el servicio del backend → Settings → Deploy → **Healthcheck Path** = `/health`: así, en cada deploy, Railway no le pasa tráfico a la versión nueva hasta que responde bien.
- **Sentry** (`utils/monitoring.js`): avisa por mail cuando hay errores del servidor (`500`), cuando falla la baja automática de un comercio, el vencimiento de pruebas o el reinicio de la demo, cuando hay una promesa rechazada sin manejar y cuando el servidor arranca con una dirección de la base que no es la red privada. Se activa con `SENTRY_DSN`; sin ella no hace nada. No envía datos personales: descarta el cuerpo de los pedidos, cookies, tokens y datos del usuario (salvo su id). Los errores de datos (`4xx`) no se envían.
- **Logs** (Railway → Deploy Logs): los errores aparecen como `[error] MÉTODO /ruta · …`, sin la consulta SQL ni datos personales.

## Seguridad y multi-comercio
- Todo recurso se filtra por `req.user.businessId`. El middleware de autenticación revalida en cada request que el usuario esté activo y con contraseña, y que el comercio esté activo.
- Roles: `admin` (todo, incluye usuarios, exportación y derechos de datos), `editor` (todo, sin usuarios), `operador` (solo compras y remitos; descuentos y precios fuera de lista con autorización de un admin o editor) y `mozo` (solo Mesas: abre mesas, manda comandas y pide la cuenta; no cobra). Al `mozo` el middleware de autenticación solo le deja usar `/api/tables`, y leer productos y categorías (`mozoCanUse` en `auth.middleware.js`).
- El **superadmin** usa un login y un token aparte (`/api/platform/*`). Ve metadatos de cuentas, nunca contenido de los comercios ni contraseñas.
- **Siempre queda un administrador:** para quitar el rol, desactivar o borrar a un `admin`, el servidor bloquea los usuarios del comercio durante el cambio (`lockUsersOf`), revisa que quien lo pide siga siendo administrador y que quede otro activo (`assertAnotherAdmin`). Si dos administradores se quitan el rol al mismo tiempo, el segundo es rechazado.
- Los usuarios se crean de dos maneras: el administrador del comercio les asigna una contraseña, o les manda una **invitación** por mail para que elijan la suya.
- Los links de invitación (vencen a los 7 días) y de restablecer contraseña (vencen a la hora) son de un solo uso. En la base solo se guarda el hash del token.
- La activación exige aceptar los términos y registra versión, fecha e IP de la aceptación.
- "Olvidé mi contraseña" responde siempre lo mismo, exista o no el email; no reenvía más de un mail por minuto y no envía nada a usuarios inactivos, comercios suspendidos ni cuentas demo. Los administradores de un comercio en baja sí pueden recuperarla, para poder exportar sus datos.
- Protecciones: `helmet`, lista de orígenes CORS, validaciones numéricas y de pertenencia entre comercios, y límites de intentos (`app.js`):
  - **Ingreso** (usuarios y superadmin): solo cuentan los intentos fallidos. 30 cada 15 minutos por IP (un local con varios empleados en la misma red no se bloquea) y 5 cada 15 minutos por cuenta (frena a quien prueba contraseñas desde muchas IP).
  - **Activar, recuperar y restablecer contraseña:** 10 pedidos cada 15 minutos por IP.
  - **Crear usuarios y enviar links** (mandan mails): 30 por día por comercio.
  - Los contadores están en memoria: se reinician con cada deploy.
- **Una sola instancia:** el backend corre en una sola instancia de Railway. Si algún día se escala a más, los límites de intentos dejarían de ser compartidos y las tareas programadas (bajas, vencimiento de pruebas, reinicio de la demo) correrían en cada una: habría que pasar los contadores a una base compartida (por ejemplo Redis) y dejar las tareas en una sola instancia.
- **Sesiones:** el token dura 8 h y lleva la versión de sesión del usuario (`tv`, columna `users.token_version`). Al restablecer la contraseña, o cuando el administrador le pone una nueva, la versión sube y las sesiones abiertas con la contraseña anterior dejan de valer. Cambiar el rol o desactivar al usuario se aplica en el pedido siguiente, porque el middleware los lee de la base. Cerrar sesión solo borra el token en ese navegador. Los tokens se verifican solo con `HS256`.
- **Contraseñas:** mínimo 8 caracteres y máximo 72 **bytes** (el límite de bcrypt), en `utils/password.js`. Se rechazan las fáciles de adivinar (`utils/passwordStrength.js`, el mismo archivo que en el frontend): las más usadas, un carácter repetido, secuencias (`12345678`, `abcdefgh`, `qwerty…`), las que contienen "talarix" y las que contienen el nombre o el email de la persona. Se guardan con bcrypt de 12 vueltas (`BCRYPT_ROUNDS`), igual que el superadmin. Las contraseñas guardadas antes con 10 siguen funcionando y pasan a 12 cuando se cambian.
- **Emails registrados:** el ingreso tarda lo mismo exista o no el email (si no existe, se compara contra un hash falso: `compareWithDummy`), y responde siempre "Credenciales inválidas". Al crear un usuario con un email que ya existe, el mensaje no dice de qué comercio es. El email es único en todo el sistema (es el usuario para ingresar), así que ese aviso no se puede evitar del todo; lo limita el tope de 30 usuarios nuevos por día por comercio.
- Cuenta **demo** (`Business.type = 'demo'`): datos de ejemplo, se reinicia todas las noches a las 03:00 (hora de Buenos Aires; `jobs/demoReset.job.js`, encendido desde `server.js`), con gestión de usuarios e importación bloqueadas. Nunca se da de baja ni se purga. Con `DEMO_RESET_ENABLED=false` (staging y local) no se reinicia; en producción tiene que estar encendido porque los términos lo prometen.

## Mesas y comandas

Para restaurantes, bares y cafés (`services/table.service.js`, migración `003`). Es un **módulo opcional**: lo activa o lo quita el superadmin desde /plataforma (`PATCH /platform/businesses/:id/modules`, guarda `businesses.tables_enabled` y queda en el registro de actividad como `business.modules_changed`). El comercio no lo puede cambiar. Sin el módulo, `/api/tables` responde `403` (salvo `GET /tables/settings`). Quitarlo no borra las mesas ni su historial.

- **Tablas:** `dining_tables` (mesas, con sector y orden), `table_tabs` (la cuenta de una mesa: `open`, `billing` = pidió la cuenta, `closed`, `cancelled`), `kitchen_tickets` (comandas, numeradas por comercio) y `tab_items` (platos, con el nombre y el precio del momento, y una nota para la cocina). Sin claves foráneas, como `parent_id` de productos.
- **Abrir:** una sola cuenta abierta por mesa (se bloquea la fila de la mesa). Guarda el mozo que la abrió.
- **Comanda:** `POST /tables/tabs/:id/tickets` con `requestId` (un doble envío es una sola comanda). **El stock baja al mandarla**, con los componentes si es un combo; si no alcanza, queda negativo, porque el plato ya se está preparando. El precio es el de lista (o el del combo).
- **Anular un plato** (`admin`, `editor`): el stock vuelve y queda quién y por qué. **Anular la mesa entera** devuelve el stock de todo lo pedido y no genera remito.
- **Cocina:** `GET /tables/kitchen` (pendientes y las listas de la última hora) y `POST /tables/tickets/:id/ready`.
- **Cobrar** (`admin`, `editor`, `operador`): `POST /tables/tabs/:id/close` con `parts: [{ paymentId, amount, tip }]`. Las partes tienen que sumar el total exacto. Genera **un remito** con todos los platos (`orders.table_tab_id`), con `createOrder` en modo mesa: no vuelve a mover el stock, no pide autorización y acepta productos desactivados después del pedido. Sin cliente elegido, usa (o crea) "Consumidor Final". Cada parte queda en `order_payments`; el reporte por forma de pago las cuenta por separado. La forma de pago del remito es la de la parte más grande.
- **Propinas:** van en `order_payments.tip`, aparte del importe: no suman al remito ni al IVA. `GET /tables/tips?from&to` las suma por mozo.
- Anular el remito de una mesa devuelve el stock, como cualquier remito.
- Un producto pedido en una mesa no se puede borrar (historial). La exportación completa incluye las hojas de mesas si el comercio las usó; la baja y el reinicio de la demo las borran.

## Mails

Los mails salen por SMTP con Nodemailer. Hay: invitación, aviso de usuario creado (nunca incluye la contraseña), restablecer contraseña y avisos de baja del comercio (plantillas en `src/utils/closureEmails.js`).

```
MAIL_HOST=mail.talarix.com.ar
MAIL_PORT=587
MAIL_USER=no-reply@talarix.com.ar
MAIL_PASS=<contraseña de la casilla>
MAIL_FROM=Talarix <no-reply@talarix.com.ar>
SUPPORT_EMAIL=hola@talarix.com.ar
```

- `MAIL_FROM` debe usar la misma casilla que `MAIL_USER`.
- Si las variables `MAIL_*` faltan o el envío falla, el sistema **no se rompe**: avisa que el mail no salió y muestra el link para copiarlo y pasarlo por otro medio.
- Para cambiar de proveedor (Resend, Brevo, etc.) alcanza con cambiar las variables.
- Si el mail cae en spam, revisar SPF y DKIM del dominio (en cPanel: *Email Deliverability*).
- Plantillas: `src/utils/mailTemplates.js` y `src/utils/closureEmails.js`.

## Baja de comercios

La baja la ejecuta el superadmin desde `/plataforma` ("Dar de baja"). Solo aplica a comercios de tipo `client`.

1. **Inicio.** `POST /api/platform/businesses/:id/closure` exige escribir el nombre exacto del comercio. Pasa `Business.status` a `closing`, guarda `delete_at` (hoy + 30 días) y avisa por mail a los administradores.
2. **Período de 30 días.** Solo el administrador puede ingresar, y únicamente para exportar sus datos. El resto de los usuarios no entra. Cualquier otra ruta responde `403` con `{ code: 'ACCOUNT_CLOSING' }`. Mientras dura la baja no se puede suspender ni reactivar el comercio.
3. **Cancelación.** `DELETE /api/platform/businesses/:id/closure` lo devuelve a `active`; no se borra nada.
4. **Borrado.** Una tarea (`node-cron`, todos los días a las 03:30, hora de Buenos Aires, y una vez 30 segundos después de cada arranque del servidor) elimina los comercios con `status = 'closing'`, `type = 'client'` y `delete_at` vencido. Borra todos sus datos (productos, clientes, remitos, usuarios, etc.) en **una sola transacción**: o se borra todo, o nada.
5. **Constancia.** Queda un registro mínimo en `closure_records` (id y nombre del comercio, fecha programada, fecha de borrado y cantidad de usuarios), sin datos de sus clientes.

Para frenar el borrado automático (por ejemplo, ante una duda o durante una restauración) cargar `DISABLE_AUTO_PURGE=true` y reiniciar la API. Los comercios siguen en `closing`, pero no se borran.

Cuando se prueba en staging, reiniciar el servicio de la **API** (no el de MySQL) para que corra la purga de arranque.

## Derechos sobre los datos
Atención de pedidos de acceso, rectificación y supresión de clientes finales de un comercio (Ley 25.326):
- **Acceso:** `GET /api/data-rights/customers/:id/export` descarga los datos de ese cliente.
- **Rectificación:** se hace editando el cliente desde la pantalla de Clientes.
- **Supresión:** `POST /api/data-rights/customers/:id/anonymize` anonimiza al cliente y **conserva sus remitos**, que son registro comercial del comercio. Además:
  - borra los textos libres de sus remitos (notas y motivo de anulación), que pueden tener su nombre o su teléfono; los importes y productos quedan;
  - lo marca con `anonymized_at`: ya no se puede editar (`409`), no se le puede hacer un remito (`400`) ni anonimizar de nuevo, y no aparece para elegir en Remitos.

Solo puede hacerlo el `admin` del comercio. Los plazos de respuesta y qué se puede anonimizar cuando haya facturas emitidas están pendientes de validación con abogado y contador.

## Superadmin
Crear el primer superadmin (apuntando a la base del entorno correspondiente):
```bash
DB_HOST=... DB_PORT=... DB_NAME=... DB_USER=... DB_PASSWORD='...' \
PLATFORM_ADMIN_EMAIL=mail@dominio.com PLATFORM_ADMIN_PASSWORD='...' PLATFORM_ADMIN_NAME='Nombre' \
node scripts/createPlatformAdmin.js
```
La contraseña del superadmin tiene que tener **al menos 12 caracteres**.

**Recuperar o cambiar la contraseña del superadmin:** a propósito no hay "Olvidé mi contraseña" en `/plataforma`: si alguien tomara el control del mail, podría quedarse con toda la plataforma. Se cambia corriendo el mismo script con el **mismo email** y la contraseña nueva: si el email ya existe, actualiza la contraseña (y lo reactiva) en lugar de crear otro. Los ingresos que ya estaban abiertos siguen valiendo hasta que vence su token (2 h). Las variables escritas en la línea de comando tienen prioridad sobre las del `.env`.

### Prueba gratis
- Al crear un comercio, "Días de prueba" guarda `trial_ends_at`. Vacío = sin vencimiento.
- **Vence sola:** `services/trialExpiry.service.js` corre cada hora (a los 5 minutos) y 40 segundos después de arrancar. Suspende a los clientes activos con `trial_ends_at` vencido: `status = 'suspended'` y `suspended_reason = 'trial_expired'`. La demo no vence; un comercio en baja sigue con su baja. Queda en el registro de actividad (`business.trial_expired`).
- Un comercio suspendido no puede usar el sistema: las sesiones abiertas se cortan y al ingresar ve "Terminó el período de prueba de este comercio. Contactanos para seguir usándolo."
- **Renovar** (`PATCH /platform/businesses/:id/trial`): hasta una fecha (vence a las 23:59:59 de ese día, hora argentina; hasta 3 años) o sin vencimiento. Si estaba suspendido por la prueba, lo reactiva. Una suspensión manual (`suspended_reason = 'manual'`) no se levanta al renovar: se reactiva con el botón de siempre.
- Con la prueba vencida, `PATCH /status` a `active` responde `409` (`TRIAL_EXPIRED`): hay que renovarla, porque si no la tarea la volvería a suspender.
- En `/plataforma`, un aviso muestra las pruebas que vencen en los próximos 3 días y las ya vencidas, con el botón **Renovar**.

### Segundo factor (Google Authenticator)
El ingreso a `/plataforma` pide la contraseña y después un código de 6 dígitos de la app. Es obligatorio: sin el segundo factor activado, el token de plataforma no sirve (lo revisa `platformAuth.middleware.js`).

1. `POST /platform/login` con email y contraseña devuelve un `mfaToken` de 10 minutos, que solo sirve para el paso siguiente.
2. **Primera vez** (`mfaSetupRequired`): `POST /platform/login/mfa/setup` genera la clave y devuelve el QR; `POST /platform/login/mfa/enable` con el primer código lo activa y devuelve **10 códigos de recuperación**, que se muestran una sola vez.
3. **Siguientes veces** (`mfaRequired`): `POST /platform/login/mfa` con el código de la app o con un código de recuperación.

Detalles:
- TOTP estándar (RFC 6238: SHA-1, 6 dígitos, 30 segundos), implementado en `utils/totp.js` con `node:crypto`. Acepta el código anterior y el siguiente por diferencias de reloj, y no acepta dos veces el mismo (`totp_last_step`).
- Los códigos de recuperación se guardan como hash (sha256) y cada uno sirve una vez. Al entrar con uno, o cuando quedan 3 o menos, la pantalla avisa.
- Límite: 5 códigos incorrectos cada 15 minutos por superadmin (además del límite por IP).
- La clave de la app se guarda en la base (`totp_secret`). Quien tenga acceso a la base puede verla: por eso el acceso a la base sigue siendo lo más importante de proteger.

**Si se pierde el celular:** entrar con un código de recuperación. Para generar códigos nuevos o pasar la app a otro celular, desactivar el segundo factor con el script y volver a ingresar: después de la contraseña se pide configurarlo otra vez con un QR nuevo.
```bash
DB_HOST=... DB_PORT=... DB_NAME=... DB_USER=... DB_PASSWORD='...' \
PLATFORM_ADMIN_EMAIL=mail@dominio.com node scripts/disablePlatformMfa.js
```
Antes de ese ingreso, borrar en Google Authenticator la entrada vieja de Talarix.

Para correr los scripts contra Railway hay que habilitar temporalmente el TCP Proxy del MySQL (Settings → Networking) y **desactivarlo al terminar**. En ese caso, `DB_HOST` y `DB_PORT` son los del proxy (`xxx.proxy.rlwy.net` y su puerto), y `DB_NAME`, `DB_USER` y `DB_PASSWORD` salen de las variables del servicio MySQL.

## Registro de actividad
Tabla `audit_logs` (sin claves foráneas: un registro sobrevive aunque se borre el usuario). Se ve en `/plataforma`, sección Actividad. `utils/audit.js` registra quién (superadmin, usuario o sistema), qué, sobre qué, desde qué IP y un detalle. Nunca corta la acción si falla el registro.

Qué se registra:
- **Superadmin:** ingresos, ingresos fallidos (contraseña o código), activación del segundo factor, uso de códigos de recuperación, alta de comercios, cambios de estado, renovación de pruebas, inicio y cancelación de bajas, reinvitaciones y reinicio de la demo.
- **Usuarios de los comercios:** exportación de todos los datos, exportación y anonimización de clientes, alta, cambios, baja y envío de links de usuarios, anulación de remitos y compras, y autorizaciones de descuentos (aprobadas y rechazadas).
- **Sistema:** vencimiento de la prueba de un comercio y eliminación definitiva de un comercio. Al eliminarlo se borran sus registros y queda solo ese último (sin datos personales).

No guarda contraseñas, códigos ni datos de clientes: solo IDs, roles y estados. Todavía no hay borrado automático de registros viejos.

## Cambios en la base de datos

**Migraciones** (desde octubre 2026). Cada cambio de base es un archivo SQL numerado en `backend/migrations/` (`001-agregar-tal-columna.sql`, `002-…`). El servidor los aplica **solo, al arrancar y antes de atender pedidos**, en orden. La tabla `schema_migrations` anota los que ya se aplicaron, así cada uno corre una sola vez en cada base (local, staging, producción). Código en `src/db/migrations.js`.

- **Base existente:** solo se aplican las migraciones pendientes. Ya **no se corre `sequelize.sync()`** (podía dejar el servidor reiniciándose en bucle si no podía crear un índice).
- **Base nueva** (vacía, sin la tabla `businesses`): se crea completa desde los modelos con `sync()` y todas las migraciones se dan por aplicadas. Por eso **cada cambio va en los dos lados: la migración y el modelo**.
- **Si una migración falla**, el servidor no arranca y el log dice cuál y en qué sentencia (`Migración 003-…, sentencia 2: …`). En Railway, el deploy queda fallado y sigue andando la versión anterior. MySQL no deshace los `ALTER`: si la sentencia 1 se aplicó y la 2 no, corregir a mano en la base lo que quedó a medias, arreglar el archivo y volver a desplegar.
- `npm run migrate` aplica las pendientes sin levantar el servidor; `npm run migrate -- --status` muestra cuáles están aplicadas y cuáles no.

**Cómo escribir una migración**
1. Crear `migrations/NNN-descripcion-corta.sql` con el número siguiente (tres cifras). Cada sentencia termina en `;` **al final de la línea**. Comentarios con `--` en su propia línea.
2. Cambiar también el modelo (para que una base nueva quede igual).
3. Escribirla para que no dependa de datos que pueden no estar: un `UPDATE` que completa datos viejos tiene que funcionar también con la tabla vacía.
4. Si agrega un índice único, la misma migración (o una anterior) limpia los datos que lo violarían.
5. Probarla en local (`npm run dev` la aplica) y después en staging (se aplica sola con el deploy).
6. Antes del merge a `main`: **backup manual de producción**. El deploy de producción la aplica.

No hace falta correr nada en la pestaña Data de Railway ni en Workbench. Para consultas a mano, lo de siempre: en Railway, **una sentencia por vez** y sin `SET` (y como le agrega `LIMIT`, los `UPDATE` con `JOIN` fallan: usar subconsultas); en Workbench, `SET SQL_SAFE_UPDATES = 0;` antes de un `UPDATE` sin clave en el `WHERE`.

El usuario de la base tiene que poder hacer `CREATE`, `ALTER`, `INDEX` y `REFERENCES` (ver los permisos de `talarix_app` en "Credenciales y rotación de claves"). Una migración que borre una tabla (`DROP TABLE`) no va a andar con ese usuario: correrla a mano como `root`.

### Historial de cambios manuales
Anteriores a las migraciones (`000-punto-de-partida.sql` marca desde dónde se cuenta). Ya aplicados en staging y producción; quedan como referencia. Una base nueva no los necesita: se crea desde los modelos. Las menciones a `sync` son de cuando corría en cada arranque.

**Clientes: anonimización y condición fiscal** (octubre 2026). El `ALTER` va **antes** de desplegar; los `UPDATE`, antes o después.
```sql
ALTER TABLE customers ADD COLUMN anonymized_at DATETIME NULL;
```
Marcar los clientes que ya se habían anonimizado antes de esta columna:
```sql
UPDATE customers SET anonymized_at = updatedAt WHERE anonymized_at IS NULL AND last_name = 'Cliente anonimizado' AND first_name IS NULL AND business_name IS NULL
```
Normalizar las condiciones fiscales cargadas con otra forma de escribir (una por vez; las que ya están bien no cambian):
```sql
UPDATE customers SET fiscal_condition = 'Responsable Inscripto' WHERE LOWER(TRIM(fiscal_condition)) IN ('responsable inscripto', 'responsable inscripta', 'ri', 'resp. inscripto')
```
```sql
UPDATE customers SET fiscal_condition = 'Consumidor Final' WHERE LOWER(TRIM(fiscal_condition)) IN ('consumidor final', 'cf', 'final')
```
```sql
UPDATE customers SET fiscal_condition = 'Monotributista' WHERE LOWER(TRIM(fiscal_condition)) IN ('monotributista', 'monotributo', 'mono')
```
```sql
UPDATE customers SET fiscal_condition = 'Exento' WHERE LOWER(TRIM(fiscal_condition)) IN ('exento', 'exenta', 'iva exento')
```
Verificar (solo tienen que aparecer los cuatro valores; si aparece otro, corregir ese cliente a mano):
```sql
SELECT fiscal_condition, COUNT(*) FROM customers GROUP BY fiscal_condition
```

**Anulación de compras** (`purchases`, octubre 2026). **Antes** de desplegar.
```sql
ALTER TABLE purchases ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE purchases ADD COLUMN cancelled_at DATETIME NULL;
ALTER TABLE purchases ADD COLUMN cancel_reason VARCHAR(255) NULL;
ALTER TABLE purchases ADD COLUMN cancelled_by_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;
ALTER TABLE purchases ADD COLUMN cancelled_by_name VARCHAR(100) NULL;
```

**Stock y remitos: número, usuario e IVA guardado** (octubre 2026). **Antes** de desplegar, y las dos `UPDATE` también: numeran los remitos que ya existían (por comercio y por fecha) y completan el IVA de los renglones viejos con el actual del producto. El índice único del número lo crea `sync`.
```sql
ALTER TABLE orders ADD COLUMN `number` INT NULL;
ALTER TABLE orders ADD COLUMN created_by_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;
ALTER TABLE orders ADD COLUMN created_by_name VARCHAR(100) NULL;
ALTER TABLE purchases ADD COLUMN created_by_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;
ALTER TABLE purchases ADD COLUMN created_by_name VARCHAR(100) NULL;
ALTER TABLE stock_movements ADD COLUMN created_by_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;
ALTER TABLE stock_movements ADD COLUMN created_by_name VARCHAR(100) NULL;
ALTER TABLE order_items ADD COLUMN vat_rate DECIMAL(5,2) NULL;
ALTER TABLE order_items ADD COLUMN other_taxes DECIMAL(5,2) NULL;

UPDATE orders
SET `number` = (
  SELECT n FROM (
    SELECT id, ROW_NUMBER() OVER (PARTITION BY business_id ORDER BY `date`, createdAt, id) AS n
    FROM orders
  ) numbered
  WHERE numbered.id = orders.id
)
WHERE `number` IS NULL;

UPDATE order_items
SET vat_rate = (SELECT p.vat_rate FROM products p WHERE p.id = order_items.product_id),
    other_taxes = (SELECT p.other_taxes FROM products p WHERE p.id = order_items.product_id)
WHERE vat_rate IS NULL AND components IS NULL;
```
Para verificar:
```sql
SELECT business_id, COUNT(*), COUNT(number), MAX(number) FROM orders GROUP BY business_id;
```
Las dos cuentas tienen que ser iguales, y el máximo igual a la cantidad.

**Anulación de remitos** (`orders`):
```sql
ALTER TABLE orders ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'active'
ALTER TABLE orders ADD COLUMN cancelled_at DATETIME NULL
ALTER TABLE orders ADD COLUMN cancel_reason VARCHAR(255) NULL
ALTER TABLE orders ADD COLUMN cancelled_by_id CHAR(36) NULL
```

**Código de barras único por comercio** (`products`):
```sql
UPDATE products SET barcode = NULL WHERE TRIM(barcode) = ''
SELECT business_id, barcode, COUNT(*) AS cantidad FROM products WHERE barcode IS NOT NULL GROUP BY business_id, barcode HAVING COUNT(*) > 1
ALTER TABLE products ADD UNIQUE INDEX uq_products_business_barcode (business_id, barcode)
```
La segunda consulta tiene que devolver 0 filas antes de crear el índice. El índice también está declarado en `product.model.js`.

**Baja de comercios** (`businesses`, octubre 2026):
```sql
ALTER TABLE businesses MODIFY COLUMN status ENUM('active','suspended','closing') NOT NULL DEFAULT 'active'
ALTER TABLE businesses ADD COLUMN delete_at DATETIME NULL
```
La tabla `closure_records` la crea `sync` sola.

**Sin borrado en cascada** (claves foráneas, 22/10/2026). Antes, borrar un cliente, proveedor o producto borraba sus remitos y compras. Para ver cómo están las claves y generar las sentencias:
```sql
SELECT k.TABLE_NAME AS tabla, k.COLUMN_NAME AS columna, k.CONSTRAINT_NAME AS clave, rc.DELETE_RULE AS al_borrar
FROM information_schema.KEY_COLUMN_USAGE k
JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
  ON rc.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND rc.CONSTRAINT_NAME = k.CONSTRAINT_NAME
WHERE k.TABLE_SCHEMA = DATABASE()
  AND ((k.TABLE_NAME = 'orders' AND k.COLUMN_NAME IN ('customer_id', 'payment_id'))
    OR (k.TABLE_NAME = 'purchases' AND k.COLUMN_NAME = 'supplier_id')
    OR (k.TABLE_NAME IN ('order_items', 'purchase_items') AND k.COLUMN_NAME = 'product_id'))
```
Las 5 tienen que decir `RESTRICT`. Se aplicó así (mismos nombres en local, staging y producción), una sentencia por vez:
```sql
ALTER TABLE `order_items` DROP FOREIGN KEY `order_items_ibfk_2`
ALTER TABLE `order_items` ADD CONSTRAINT `order_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
ALTER TABLE `orders` DROP FOREIGN KEY `orders_ibfk_2`
ALTER TABLE `orders` ADD CONSTRAINT `orders_ibfk_2` FOREIGN KEY (`customer_id`) REFERENCES `customers` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
ALTER TABLE `orders` DROP FOREIGN KEY `orders_ibfk_3`
ALTER TABLE `orders` ADD CONSTRAINT `orders_ibfk_3` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
ALTER TABLE `purchase_items` DROP FOREIGN KEY `purchase_items_ibfk_2`
ALTER TABLE `purchase_items` ADD CONSTRAINT `purchase_items_ibfk_2` FOREIGN KEY (`product_id`) REFERENCES `products` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
ALTER TABLE `purchases` DROP FOREIGN KEY `purchases_ibfk_2`
ALTER TABLE `purchases` ADD CONSTRAINT `purchases_ibfk_2` FOREIGN KEY (`supplier_id`) REFERENCES `suppliers` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
```
Una base nueva ya nace con `RESTRICT` (está declarado en `models/index.js`).

**Envíos duplicados** (`orders`, `purchases`, 23/10/2026). Hay que correrlo **antes** de desplegar el código: si el índice está declarado y la columna no existe, `sync` falla y el servidor no arranca.
```sql
ALTER TABLE orders ADD COLUMN request_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL
ALTER TABLE orders ADD UNIQUE INDEX uq_orders_business_request (business_id, request_id)
ALTER TABLE purchases ADD COLUMN request_id CHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL
ALTER TABLE purchases ADD UNIQUE INDEX uq_purchases_business_request (business_id, request_id)
```
Los remitos y compras anteriores quedan con `request_id` en `NULL`, que el índice único admite.

**Segundo factor del superadmin** (`platform_admins`, 24/10/2026). **Antes** de desplegar: el modelo lee estas columnas en cada ingreso. La tabla `audit_logs` la crea `sync`.
```sql
ALTER TABLE platform_admins ADD COLUMN totp_enabled TINYINT(1) NOT NULL DEFAULT 0
ALTER TABLE platform_admins ADD COLUMN totp_secret VARCHAR(64) NULL
ALTER TABLE platform_admins ADD COLUMN totp_pending_secret VARCHAR(64) NULL
ALTER TABLE platform_admins ADD COLUMN totp_last_step BIGINT NULL
ALTER TABLE platform_admins ADD COLUMN recovery_codes JSON NULL
```

**Versión de sesión** (`users`, 23/10/2026). También **antes** de desplegar: el modelo lee la columna en cada ingreso y en cada pedido.
```sql
ALTER TABLE users ADD COLUMN token_version INT NOT NULL DEFAULT 0
```

**Productos por peso y balanza** (octubre 2026):
```sql
ALTER TABLE businesses ADD COLUMN scale_config JSON NULL
ALTER TABLE products ADD COLUMN scale_plu INT NULL
ALTER TABLE products MODIFY COLUMN stock DECIMAL(12,3) NOT NULL DEFAULT 0
ALTER TABLE order_items MODIFY COLUMN quantity DECIMAL(12,3) NOT NULL
ALTER TABLE purchase_items MODIFY COLUMN quantity DECIMAL(12,3) NOT NULL
ALTER TABLE stock_movements MODIFY COLUMN quantity DECIMAL(12,3) NOT NULL
CREATE UNIQUE INDEX uq_products_business_scale_plu ON products (business_id, scale_plu)
```
El último solo hace falta si `sync` no crea el índice (está declarado en `product.model.js`). Los datos enteros existentes se convierten solos a 3 decimales.

## Flujo de trabajo

El repositorio es único (`romidenardi/talarix`, público) y contiene `backend/` y `frontend/`. **Hacer `git add` y `commit` desde la raíz del repo**: si se hace desde una sola de las carpetas, los cambios de la otra no se incluyen.

1. Trabajar en la rama `staging`. Antes del commit, en `backend` y en `frontend`: `npm run format` (ordena el formato) y `npm run lint` (tiene que dar sin errores). GitHub Actions revisa las dos cosas en cada push. Push: Railway y Vercel despliegan solos en staging.
2. Probar en la URL de staging.
3. Si hay migraciones nuevas: backup manual de producción **antes** del merge. El deploy las aplica (ver "Cambios en la base de datos").
4. Si todo anda bien, pasar a producción:
```bash
git checkout main
git pull
git merge staging
git push
git checkout staging
```
5. Si Railway no puede bajar un commit ("failed to fetch snapshot"), no usar **Redeploy**: vuelve a desplegar el mismo commit, que puede no existir más (por ejemplo, después de limpiar el historial). Usar **Deploy Latest Commit** o hacer un commit vacío (`git commit --allow-empty`) y push.
6. Si se agrega una dependencia nueva, hacer `npm install <paquete>` en la carpeta correspondiente y subir `package.json` y `package-lock.json` juntos. Si falta, el deploy falla con `Cannot find package`. Dependencias recientes: `node-cron` y `xlsx`.
7. **`xlsx` no se actualiza desde npm:** SheetJS dejó de publicar ahí y la última versión de npm (0.18.5) tiene vulnerabilidades. Se instala desde su CDN: `npm install https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` (en `backend`). Para una versión nueva, cambiar el número en esa dirección (ver docs.sheetjs.com).

## Backups
Railway Pro: backups diarios (se guardan 6 días), semanales (27 días) y mensuales (89 días) del MySQL de producción. Los términos y la política de privacidad hablan de un plazo aproximado de 90 días.

Restaurar: servicio MySQL → Backups → elegir fecha → Restore → revisar → Deploy. Detalles:
- La restauración crea un **volumen nuevo** (tarda menos de 20 segundos en la base actual) y solo funciona dentro del mismo proyecto y entorno.
- Es **todo o nada**: no hay restauración por comercio. Recuperar los datos de un solo comercio implica restaurar a un volumen nuevo y copiar lo necesario a mano.
- Se probó en staging (octubre 2026): los datos y el backend volvieron correctamente.
- Antes de un merge a `main` que trae migraciones nuevas, crear un backup manual.
- Si se restaura un backup anterior a una baja, revisar los comercios en `closing` y considerar `DISABLE_AUTO_PURGE=true` hasta verificar.
- Un backup restaura la base **completa, incluidos los usuarios de MySQL y sus contraseñas**. Si se restaura uno anterior al 22/10/2026, el usuario `talarix_app` no existe y `root` vuelve a la contraseña expuesta: hay que crear `talarix_app` de nuevo y cambiar la clave de `root` (ver "Credenciales y rotación de claves").

## Credenciales y rotación de claves

**Reglas**
- El `.env` nunca va al repo. Lo excluye el `.gitignore` de la raíz; `node_modules` también. Guardar una copia del `.env` local fuera del repo.
- Cada entorno tiene sus propias claves: nunca repetir las de producción en staging ni en local.
- Generar claves con `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` (solo letras y números) y **anotarlas en un archivo antes de usarlas**: una clave de MySQL perdida a mitad de un cambio no se recupera.
- La app se conecta con el usuario `talarix_app`, no con `root`, con los permisos justos sobre la base `railway`: `SELECT, INSERT, UPDATE, DELETE` para trabajar y `CREATE, ALTER, INDEX, REFERENCES` para las migraciones. No puede borrar tablas (`DROP`) ni dar permisos. `root` queda para el panel de Railway (pestaña Data). Se revisa con `SHOW GRANTS FOR 'talarix_app'@'%'`.
- **Conexión cifrada con la base:** `DB_HOST` tiene que ser la dirección interna de Railway (`….railway.internal`): el tráfico entre servicios del proyecto va por túneles WireGuard, cifrado. Con la dirección pública (`….proxy.rlwy.net`) saldría a internet sin cifrar. Si en Railway el servidor arranca con una dirección que no es la interna, lo avisa en el log (`[base] DB_HOST … no es la red privada`) y en Sentry (`utils/dbHost.js`).
- Cuentas de GitHub, Railway, Vercel y mail con segundo factor (2FA).

**Historial (octubre 2026)**
- El repo era público y `backend/.env` estuvo versionado. El 22/10/2026 se rotaron los secretos y se limpió el historial con `git filter-repo` (sin `.env` ni `node_modules`) y `push --force`. Los clones anteriores tienen el historial viejo: no se usan más.
- El mismo día, Railway informó un acceso no autorizado a variables de entorno de sus clientes. Se rotaron todas las claves de staging y producción (JWT, mail y base). Staging pasó a una base nueva (servicio `MySQL-UOHe`); la anterior quedó sin uso, pendiente de borrar.

**Cómo rotar**
- `JWT_SECRET` / `PLATFORM_JWT_SECRET`: cambiar la variable y desplegar. Todas las sesiones se cortan y los usuarios vuelven a ingresar.
- `MAIL_PASS`: cambiarla en el proveedor de mail y enseguida en Railway, en los dos entornos. Hasta desplegar, los mails fallan.
- Base de datos, sin cortar el servicio:
  1. Crear un usuario nuevo con clave nueva (en Data → Query):
     ```sql
     CREATE USER 'talarix_app2'@'%' IDENTIFIED BY '<clave>';
     GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON railway.* TO 'talarix_app2'@'%';
     ```
  2. Cambiar `DB_USER` y `DB_PASSWORD` del backend, desplegar y comprobar el ingreso. Con `SELECT user FROM information_schema.processlist;` se ve qué usuario usa la app.
  3. Borrar el usuario anterior (`DROP USER 'talarix_app'@'%';`).
- Clave de `root`: `ALTER USER 'root'@'%' IDENTIFIED BY '<clave>';` y lo mismo para `'root'@'localhost'`, con la misma clave. Enseguida, poner esa clave en `MYSQL_ROOT_PASSWORD` (y en `MYSQLPASSWORD` si no es una referencia) y aplicar los cambios. MySQL se reinicia y la app se corta unos segundos.

## Textos legales
La versión vigente de los términos y del aviso de privacidad está en `src/utils/legal.js` y debe coincidir con `LEGAL_VERSION` del frontend. Hoy es un borrador (`2026-10-borrador-1`) pendiente de revisión legal. La casilla de contacto es `hola@talarix.com.ar`.

---
Última actualización: 27/10/2026 (migraciones, reportes en la base, vencimiento de pruebas, red privada y permisos mínimos de la base, limpieza de comentarios).
