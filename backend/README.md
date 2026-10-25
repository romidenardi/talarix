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
- Node.js 20 o superior (Railway usa la versión 24).
- MySQL local, o acceso a una base de desarrollo.

## Puesta en marcha local
```bash
npm install
cp .env.example .env   # si no existe, crear .env con las variables de abajo
npm run dev            # nodemon server.js
```

**Base local desde cero** (lo más simple si la base local quedó atrasada respecto de staging y producción):
1. En el cliente de MySQL: `DROP DATABASE <DB_NAME>;` y `CREATE DATABASE <DB_NAME>;`.
2. `npm run dev`: `sync` crea todas las tablas con sus columnas actuales.
3. Crear el superadmin con `scripts/createPlatformAdmin.js` (ver "Superadmin") y un comercio desde `/plataforma`.

Una base local vieja falla al arrancar si le faltan los cambios manuales del historial (por ejemplo, duplicados en el índice único de códigos de barras).

| Script | Qué hace |
|---|---|
| `npm run dev` | Arranca con recarga automática (nodemon) |
| `npm start` | Arranca para producción (`node server.js`) |
| `npm test` | Pruebas unitarias (no necesitan base de datos) |
| `npm run test:integration` | Pruebas de la API contra una base MySQL de pruebas (ver "Tests") |

Al iniciar, el servidor valida las variables obligatorias, verifica que `JWT_SECRET` y `PLATFORM_JWT_SECRET` sean distintas, activa Sentry si está configurado, se conecta a MySQL, ejecuta `sequelize.sync()` (ver "Cambios en la base de datos") y, una vez escuchando, arranca las tareas programadas (bajas y reinicio de la demo). Al recibir `SIGTERM` (Railway lo manda en cada deploy) se cierra en orden: deja de aceptar pedidos, termina los que están en curso (hasta 10 s), para las tareas y cierra la conexión con la base.

## Variables de entorno

| Variable | Obligatoria | Descripción |
|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | Sí | Conexión a MySQL. En producción la app usa el usuario `talarix_app`, no `root` (ver "Credenciales y rotación de claves") |
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
server.js          arranque: valida variables, Sentry, conecta, sync, listen, tareas y cierre ordenado
test/unit/         pruebas unitarias (node --test)
test/integration/  pruebas de la API contra MySQL
../.github/workflows/ci.yml   integración continua en GitHub Actions
src/
  app.js           Express: middlewares globales y montaje de rutas
  config/          conexión a la base (database.js)
  controllers/     lógica de cada recurso
  routes/          definición de rutas
  models/          modelos Sequelize
  middlewares/     auth, roles, demo, errores
  services/        servicios: datos de la cuenta demo, exportación a Excel,
                   borrado de un comercio y programador de bajas
  jobs/            tareas programadas (reinicio nocturno de la demo)
  utils/           ayudas: asyncHandler, httpError, números y cantidades
                   (numbers.js), getter de columnas decimales
                   (decimalColumn.js), formato de etiquetas de balanza
                   (scaleConfig.js), tokens de invitación, versión de
                   términos, mails y links de acceso, mails de baja
scripts/           scripts de operación (crear superadmin)
```

## API

Todas las rutas cuelgan de `/api`. Salvo `auth` y `platform`, exigen token de usuario.

| Ruta | Acceso | Qué hace |
|---|---|---|
| `/auth/login`, `/auth/activate` | pública | Ingreso y activación de cuenta con aceptación de términos |
| `/auth/forgot-password`, `/auth/reset-password` | pública | Recuperar contraseña por mail |
| `/platform/login`, `/platform/login/mfa*` | pública | Ingreso del superadmin en dos pasos (contraseña y código de Google Authenticator) |
| `/platform/*` | superadmin | Alta de comercios, estado, reinvitar, reiniciar demo |
| `/platform/audit` | superadmin | Registro de actividad (`?limit=` hasta 500, `?businessId=`) |
| `/platform/businesses/:id/closure` | superadmin | `POST` inicia la baja (pide el nombre exacto del comercio en `confirmName`); `DELETE` la cancela |
| `/categories`, `/products`, `/stock-movements` | autenticados | Catálogo y movimientos de stock |
| `/combos` | autenticados | Combos de productos |
| `/scale-config` | `GET`: autenticados; `PUT`: `admin`, `editor` | Formato de las etiquetas de la balanza del comercio |
| `/payments`, `/customers`, `/suppliers` | autenticados | Formas de pago (cuotas y descuentos), clientes, proveedores |
| `/purchases`, `/orders` | autenticados | Compras y remitos |
| `/orders/:id/cancel` | `admin`, `editor` | Anula un remito y devuelve el stock |
| `/orders/approval` | `operador` | Autorización de un admin o editor (su email y contraseña) para un remito con descuento o precio fuera de lista |
| `/reports/*` | `admin`, `editor` | Panel de inicio y reportes (ventas, productos, clientes, formas de pago, IVA) |
| `/imports` | `admin`, `editor` | Importación desde Excel (bloqueada en demo) |
| `/users` | `admin` | Usuarios del comercio (bloqueada en demo) |
| `/export` | `admin` | Descarga de todos los datos del comercio en un Excel. **Única ruta disponible durante la baja** |
| `/data-rights/customers/:id/export` | `admin` | Exporta los datos de un cliente (pedido de acceso) |
| `/data-rights/customers/:id/anonymize` | `admin` | Anonimiza a un cliente (pedido de supresión), conservando sus remitos |

Detalles que conviene saber:
- Los precios incluyen IVA. `Order.total` es el final, después de descuentos; las cuotas son informativas.
- Los remitos anulados (`status = 'cancelled'`) quedan en el historial y se excluyen de los reportes.
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
- **Importación:** hasta 5 MB y 5.000 filas por archivo, solo la primera hoja. Además del filtro por extensión, `utils/parseSpreadsheet.js` revisa que el contenido coincida (un .xlsx tiene que ser un ZIP; un .csv, texto) y responde `400` con un mensaje claro si el archivo no se puede leer.
- La importación acepta la columna opcional `PLU Balanza` (solo con `Unidad = peso`); en productos por peso, Precio y Costo son por kg.

## Tests
Se usa el corredor de pruebas que viene con Node (`node --test`): no hay librerías extra.

- **Unitarias** (`npm test`, en `test/unit/`): números y cantidades, IVA e impuestos internos, combos, configuración de la balanza, y que el cálculo del frontend (`frontend/src/utils/taxes.js`) dé lo mismo que el del backend. No necesitan base.
- **Integración** (`npm run test:integration`, en `test/integration/`): levantan la API de verdad contra MySQL y prueban remitos (crear, stock, peso, doble envío, falta de stock, anular), la autorización de descuentos del operador, productos y formas de pago inactivos, aislamiento entre comercios y borrado de productos con ventas.
  - **Borran y crean de nuevo la base `talarix_test`** (o la de `TEST_DB_NAME`) en cada corrida. Por seguridad, el nombre tiene que terminar en `_test`: no pueden tocar la base de trabajo.
  - En local usan `DB_HOST`, `DB_PORT`, `DB_USER` y `DB_PASSWORD` del `.env`. El usuario tiene que poder crear bases (con `root` local alcanza).
- **GitHub Actions** (`.github/workflows/ci.yml`, en la raíz del repo): en cada push a `staging` o `main` corre las dos clases de pruebas con un MySQL propio, `npm audit` (falla con vulnerabilidades altas o críticas) y la compilación del frontend. El resultado se ve en la pestaña **Actions** del repo y al lado de cada commit (✓ o ✗).

Al agregar algo que mueve stock o plata, sumar su prueba. Antes de hacer el merge a `main`, el último commit de `staging` tiene que estar en verde.

## Monitoreo
- **`GET /health`**: responde `{"status":"ok"}` si el servidor anda y llega a la base, o `503` si no. No pide token ni devuelve datos. En Railway se configura en el servicio del backend → Settings → Deploy → **Healthcheck Path** = `/health`: así, en cada deploy, Railway no le pasa tráfico a la versión nueva hasta que responde bien.
- **Sentry** (`utils/monitoring.js`): avisa por mail cuando hay errores del servidor (`500`), cuando falla la baja automática de un comercio o el reinicio de la demo, y cuando hay una promesa rechazada sin manejar. Se activa con `SENTRY_DSN`; sin ella no hace nada. No envía datos personales: descarta el cuerpo de los pedidos, cookies, tokens y datos del usuario (salvo su id). Los errores de datos (`4xx`) no se envían.
- **Logs** (Railway → Deploy Logs): los errores aparecen como `[error] MÉTODO /ruta · …`, sin la consulta SQL ni datos personales.

## Seguridad y multi-comercio
- Todo recurso se filtra por `req.user.businessId`. El middleware de autenticación revalida en cada request que el usuario esté activo y con contraseña, y que el comercio esté activo.
- Roles: `admin` (todo, incluye usuarios, exportación y derechos de datos), `editor` (todo, sin usuarios) y `operador` (solo compras y remitos; descuentos y precios fuera de lista con autorización de un admin o editor).
- El **superadmin** usa un login y un token aparte (`/api/platform/*`). Ve metadatos de cuentas, nunca contenido de los comercios ni contraseñas.
- Los usuarios se crean de dos maneras: el administrador del comercio les asigna una contraseña, o les manda una **invitación** por mail para que elijan la suya.
- Los links de invitación (vencen a los 7 días) y de restablecer contraseña (vencen a la hora) son de un solo uso. En la base solo se guarda el hash del token.
- La activación exige aceptar los términos y registra versión, fecha e IP de la aceptación.
- "Olvidé mi contraseña" responde siempre lo mismo, exista o no el email; no reenvía más de un mail por minuto y no envía nada a usuarios inactivos, comercios suspendidos ni cuentas demo. Los administradores de un comercio en baja sí pueden recuperarla, para poder exportar sus datos.
- Protecciones: `helmet`, lista de orígenes CORS, validaciones numéricas y de pertenencia entre comercios, y límites de intentos (`app.js`):
  - **Ingreso** (usuarios y superadmin): solo cuentan los intentos fallidos. 30 cada 15 minutos por IP (un local con varios empleados en la misma red no se bloquea) y 5 cada 15 minutos por cuenta (frena a quien prueba contraseñas desde muchas IP).
  - **Activar, recuperar y restablecer contraseña:** 10 pedidos cada 15 minutos por IP.
  - **Crear usuarios y enviar links** (mandan mails): 30 por día por comercio.
  - Los contadores están en memoria: se reinician con cada deploy y no se comparten si algún día hay más de una instancia.
- **Sesiones:** el token dura 8 h y lleva la versión de sesión del usuario (`tv`, columna `users.token_version`). Al restablecer la contraseña, o cuando el administrador le pone una nueva, la versión sube y las sesiones abiertas con la contraseña anterior dejan de valer. Cambiar el rol o desactivar al usuario se aplica en el pedido siguiente, porque el middleware los lee de la base. Cerrar sesión solo borra el token en ese navegador. Los tokens se verifican solo con `HS256`.
- **Contraseñas:** mínimo 8 caracteres y máximo 72 **bytes** (el límite de bcrypt), en `utils/password.js`. Se guardan con bcrypt de 12 vueltas (`BCRYPT_ROUNDS`), igual que el superadmin. Las contraseñas guardadas antes con 10 siguen funcionando y pasan a 12 cuando se cambian.
- La exportación tiene límite de 5 pedidos por hora por usuario.
- Cuenta **demo** (`Business.type = 'demo'`): datos de ejemplo, se reinicia todas las noches a las 03:00 (hora de Buenos Aires; `jobs/demoReset.job.js`, encendido desde `server.js`), con gestión de usuarios e importación bloqueadas. Nunca se da de baja ni se purga. Con `DEMO_RESET_ENABLED=false` (staging y local) no se reinicia; en producción tiene que estar encendido porque los términos lo prometen.

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
- **Supresión:** `POST /api/data-rights/customers/:id/anonymize` anonimiza al cliente y **conserva sus remitos**, que son registro comercial del comercio.

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
Tabla `audit_logs` (la crea `sync`, sin claves foráneas: un registro sobrevive aunque se borre el usuario). Se ve en `/plataforma`, sección Actividad. `utils/audit.js` registra quién (superadmin, usuario o sistema), qué, sobre qué, desde qué IP y un detalle. Nunca corta la acción si falla el registro.

Qué se registra:
- **Superadmin:** ingresos, ingresos fallidos (contraseña o código), activación del segundo factor, uso de códigos de recuperación, alta de comercios, cambios de estado, inicio y cancelación de bajas, reinvitaciones y reinicio de la demo.
- **Usuarios de los comercios:** exportación de todos los datos, exportación y anonimización de clientes, alta, cambios, baja y envío de links de usuarios, y anulación de remitos.
- **Sistema:** eliminación definitiva de un comercio. Al eliminarlo se borran sus registros y queda solo ese último (sin datos personales).

No guarda contraseñas, códigos ni datos de clientes: solo IDs, roles y estados. Todavía no hay borrado automático de registros viejos.

## Cambios en la base de datos

`sequelize.sync()` corre en cada arranque. Hace dos cosas:
- **Crea las tablas nuevas** que falten (por ejemplo, `closure_records`).
- **Agrega los índices declarados en los modelos**, aun en tablas existentes. Si los datos no cumplen el índice (por ejemplo, duplicados en un índice único), **el servidor no arranca y Railway lo reinicia en bucle**.

No modifica columnas existentes: esos cambios se hacen con `ALTER TABLE` manual.

Regla de oro: **todo cambio de base se corre en producción antes de hacer el merge a `main`**.

1. Probar en la base de staging, una sentencia por vez (Railway → MySQL → Data → Query).
2. Si el cambio incluye un índice único, limpiar primero los datos que lo violarían.
3. Correrlo en la base de producción (con un backup manual hecho antes).
4. Recién entonces, hacer el merge a `main`.

### Historial de cambios manuales
Ya aplicados en staging y producción. Una base nueva creada desde cero no los necesita: `sync` crea las tablas con sus columnas actuales.

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
ALTER TABLE orders ADD COLUMN request_id CHAR(36) BINARY NULL
ALTER TABLE orders ADD UNIQUE INDEX uq_orders_business_request (business_id, request_id)
ALTER TABLE purchases ADD COLUMN request_id CHAR(36) BINARY NULL
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

1. Trabajar en la rama `staging` y hacer push: Railway y Vercel despliegan solos en staging.
2. Probar en la URL de staging.
3. Si hubo cambios de base, correrlos en producción **antes** del merge (ver arriba).
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
- Antes de un cambio de base en producción, crear un backup manual.
- Si se restaura un backup anterior a una baja, revisar los comercios en `closing` y considerar `DISABLE_AUTO_PURGE=true` hasta verificar.
- Un backup restaura la base **completa, incluidos los usuarios de MySQL y sus contraseñas**. Si se restaura uno anterior al 22/10/2026, el usuario `talarix_app` no existe y `root` vuelve a la contraseña expuesta: hay que crear `talarix_app` de nuevo y cambiar la clave de `root` (ver "Credenciales y rotación de claves").

## Credenciales y rotación de claves

**Reglas**
- El `.env` nunca va al repo. Lo excluye el `.gitignore` de la raíz; `node_modules` también. Guardar una copia del `.env` local fuera del repo.
- Cada entorno tiene sus propias claves: nunca repetir las de producción en staging ni en local.
- Generar claves con `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` (solo letras y números) y **anotarlas en un archivo antes de usarlas**: una clave de MySQL perdida a mitad de un cambio no se recupera.
- La app de producción se conecta con el usuario `talarix_app` (`ALL PRIVILEGES` sobre la base `railway`), no con `root`. `root` queda para el panel de Railway (pestaña Data).
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
     GRANT ALL PRIVILEGES ON railway.* TO 'talarix_app2'@'%';
     ```
  2. Cambiar `DB_USER` y `DB_PASSWORD` del backend, desplegar y comprobar el ingreso. Con `SELECT user FROM information_schema.processlist;` se ve qué usuario usa la app.
  3. Borrar el usuario anterior (`DROP USER 'talarix_app'@'%';`).
- Clave de `root`: `ALTER USER 'root'@'%' IDENTIFIED BY '<clave>';` y lo mismo para `'root'@'localhost'`, con la misma clave. Enseguida, poner esa clave en `MYSQL_ROOT_PASSWORD` (y en `MYSQLPASSWORD` si no es una referencia) y aplicar los cambios. MySQL se reinicia y la app se corta unos segundos.

## Textos legales
La versión vigente de los términos y del aviso de privacidad está en `src/utils/legal.js` y debe coincidir con `LEGAL_VERSION` del frontend. Hoy es un borrador (`2026-10-borrador-1`) pendiente de revisión legal. La casilla de contacto es `hola@talarix.com.ar`.

---
Última actualización: 25/10/2026 (tests, integración continua, /health, cierre ordenado y Sentry).
