# Talarix: Frontend

Interfaz web del sistema de gestión para pequeños comercios (stock, clientes, proveedores, compras, remitos, formas de pago, reportes, productos por peso con balanza).

**Stack:** React 19, Vite, React Router 7, React Hook Form, Axios. Desplegado en Vercel.

Dominio de producción: `app.talarix.com.ar`.

## Puesta en marcha local
```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # genera dist/ (no se versiona)
npm run preview  # sirve el build localmente
npm run lint     # ESLint (reglas recomendadas), igual que el backend
npm run format   # ordena el formato con Prettier (format:check solo revisa)
```

## Variables de entorno
| Variable | Descripción |
|---|---|
| `VITE_API_URL` | URL base del backend, incluyendo `/api` (ej. `https://api.talarix.com.ar/api`) |

**En local**, crear `frontend/.env.local` (el `.gitignore` del frontend lo excluye) con:
```
VITE_API_URL=http://localhost:3000/api
```
El puerto es el `PORT` del `backend/.env`. Sin ese archivo, el frontend local llama a la API de producción y el ingreso falla con un error de CORS. Después de crearlo o cambiarlo, reiniciar `npm run dev`.

Las variables de Vite se incorporan **al construir**: si cambian en Vercel, hay que redesplegar.

En Vercel hay una variable por entorno: una para **Production** y otra para **Preview** limitada a la rama `staging`.

## Rutas
| Ruta | Acceso |
|---|---|
| `/login` | pública |
| `/activar?token=...` | pública (activación de cuenta con aceptación de términos) |
| `/olvide-contrasena` | pública (pide el mail para recuperar la contraseña) |
| `/restablecer?token=...` | pública (elegir una contraseña nueva desde el link del mail) |
| `/terminos`, `/privacidad` | públicas |
| `/plataforma/login`, `/plataforma` | superadmin (token aparte, guardado en `sessionStorage`) |
| `/`, `/orders`, `/purchases` | usuarios autenticados |
| `/orders/:id/print` | usuarios autenticados (remito para imprimir) |
| `/exportar` | usuarios autenticados; la pantalla solo deja exportar al `admin`. Es la única disponible cuando el comercio está en baja |
| `/reports`, `/categories`, `/payments`, `/customers`, `/products`, `/suppliers`, `/imports` | `admin` y `editor` |
| `/users` | `admin` |

Las rutas están en `src/routes/AppRoutes.jsx`. Al agregar una pantalla, **partir siempre del archivo actual del repo**: si se reconstruye desde una copia vieja se pierden rutas.

## Estructura
```
src/
  api/          cliente HTTP (axios.js) y llamadas por recurso
  context/      AuthContext (sesión, rol, modo demo, comercio en baja) y
                DialogContext (recuadros de confirmación)
  hooks/        useResource (listas), useMessage (avisos), useUrlToken
                (token de los links de los mails)
  components/   layout (menú y barra lateral) y componentes compartidos
                (Required.jsx: marca (*) y leyenda de campo obligatorio)
  pages/        una carpeta por pantalla (Export/ tiene la exportación de datos)
  legal/        textos de términos y privacidad (legalContent.js)
  routes/       definición de rutas y rutas privadas
  utils/        ayudas de formato y descarga de archivos (download.js),
                cantidades y productos por peso (quantity.js), lectura de
                etiquetas de balanza (scale.js), CUIT (taxId.js),
                contraseñas, IVA (taxes.js) y errores del servidor
                (serverErrors.js)
  index.css     estilos globales y variables de color
```

## Sesión
- Al ingresar se guardan `token` y `user` en `localStorage`, junto con `businessStatus` y la fecha de borrado si el comercio está en baja.
- `src/api/axios.js` agrega el token a cada pedido y, ante un `401` (salvo en el login), borra la sesión y vuelve a `/login`.
- Ante un `403` con `code: 'ACCOUNT_CLOSING'`, marca el comercio como `closing` en `localStorage` y redirige a `/exportar`.
- El token del superadmin se guarda aparte, en `sessionStorage`.
- **Ingreso del superadmin** (`pages/Platform/PlatformLogin.jsx`), en pasos: contraseña → código de 6 dígitos de Google Authenticator (o un código de recuperación). La primera vez, en lugar del código, muestra el QR para agregar Talarix a la app, pide el primer código y muestra los 10 códigos de recuperación una sola vez (hay que tildar "Ya los guardé" para seguir). Avisa si se entró con un código de recuperación o si quedan 3 o menos.
- **Actividad** (`pages/Platform/AuditLog.jsx`): al pie de `/plataforma`, los últimos 200 registros del log de auditoría (fecha, quién, comercio, acción, detalle e IP). Los ingresos fallidos y el uso de códigos de recuperación se resaltan. Para una acción nueva del backend, agregar su texto en `ACTION_LABELS`.

## Funciones a tener en cuenta
- **Códigos de barras:** se pueden cargar y buscar con la **cámara del celular** (librería `html5-qrcode`) o con un **lector USB**, que funciona como teclado: escribe el código y envía Enter. Dentro de los campos de código de barras el Enter está bloqueado para no enviar el formulario por error. La cámara solo funciona con **HTTPS** (en `localhost` también).
- **Productos por peso:** el precio, el costo y la promo se guardan **por kg**. Al cargar o editar el producto se puede elegir "Cargo precio y costo por" (kg, 500 g, 250 g, 100 g o 1 g) y el sistema lo convierte y muestra cómo queda guardado. En remitos y compras la cantidad se escribe en **kg o g** (selector al lado) y se muestra el cálculo (`0,100 kg × $30.000,00 por kg = $3.000,00`). Las tablas y el remito impreso muestran `/kg`. Los productos por peso no se ofrecen en combos. Las ayudas están en `utils/quantity.js`.
- **Balanza** (Productos → pestaña **Balanza**): activa la lectura de etiquetas EAN-13 (valores de fábrica de Systel) y permite ajustar prefijo, posiciones, si la etiqueta trae peso (CANTID) o importe (TOTAL), decimales y dígito de control. Tiene un probador donde se pega el número de una etiqueta. Cada producto por peso lleva su **PLU de balanza**. En **Remitos**, la barra "Escanear código de barras" reconoce la etiqueta (`utils/scale.js`), busca el producto por PLU y suma el peso, o el importe dividido por el precio del sistema (redondeado al gramo). Ojo: una etiqueta que trae solo el importe no dice el peso, así que no hay forma de detectar si la balanza tenía otro precio: hay que mantener los precios de la balanza iguales a los del sistema. Con etiquetas de peso no hay ese problema. Un código que coincide con un código de barras o interno se toma primero como producto. Las Compras no leen etiquetas de balanza. **Avisos:** si el último número (dígito de control) no cierra, la etiqueta se leyó mal: se avisa cuál es y cuál debería ser, y no se ofrece crear un producto con ese código (`readScaleCode` y `scaleCodeProblem` en `utils/scale.js`). Un PLU que ningún producto tiene, un producto inactivo o sin precio también tienen su aviso. El probador de la pestaña Balanza muestra el mismo motivo.
- **Listas** (`hooks/useResource.js`): después de un alta, un cambio o una baja, la lista se actualiza con lo que devolvió el servidor, sin volver a pedir todo. Categorías y Productos recargan la lista entera (`{ reloadAfterChange: true }`), porque un cambio afecta a otros registros (subcategorías, combos).
- **Avisos:** no hay avisos flotantes. Cada aviso aparece donde ocurrió la acción:
  - **Errores de un campo** (de la validación del formulario o del servidor) debajo del campo. Para los errores del servidor se usa `applyServerFieldErrors` y `fieldFromMessage` de `utils/serverErrors.js`.
  - **Otros errores** (por ejemplo "no se puede eliminar porque tiene remitos") en un recuadro rojo junto al botón del formulario, o en la fila de la tabla donde se apretó Eliminar o Anular. Quedan hasta que se cierran (×) o se hace otra acción.
  - **Lo que salió bien** ("Cliente agregado", "Remito generado") en un recuadro verde junto al botón, que se va solo a los 4 segundos. Al borrar, el aviso aparece arriba de la tabla.
  - Se usan `components/common/FormMessage.jsx` y `hooks/useMessage.js`. `useResource` no muestra avisos: devuelve el resultado y cada pantalla lo muestra. Las preguntas de confirmación tampoco son las del navegador:
  - `context/DialogContext.jsx` (envuelve toda la app en `App.jsx`) da `useDialog()` con `confirm`, `prompt` y `alert`, que devuelven una promesa: `if (!(await dialog.confirm({ message, confirmLabel: 'Eliminar', danger: true }))) return;`. Se ven igual en todos los navegadores y en el celular no se bloquean. **No usar** `window.confirm`, `prompt` ni `alert`.
  - Remitos y compras: si el remito falla después de crear un cliente o un producto nuevo (o la compra, un proveedor o producto nuevo), el aviso dice cuáles ya quedaron creados. Si el total que guarda el servidor no coincide con el que mostraba la pantalla, aparece un aviso en rojo: vale el del servidor.
- **Campos obligatorios:** en los formularios, los campos obligatorios llevan `(*)` y al pie se muestra "(*) Campo obligatorio" en el color de alerta. Se usa `RequiredMark` y `RequiredLegend` de `components/common/Required.jsx`.
- **Usuarios** (solo `admin`): siempre queda al menos un administrador activo (lo controla el servidor, también si dos se quitan el rol al mismo tiempo). Se pueden crear con contraseña asignada, o enviando una **invitación por mail**. Cada usuario tiene un botón para reenviar la invitación o enviar un link de contraseña. Si el mail no sale, se muestra el link para copiarlo.
- **Prueba gratis** (`/plataforma`): arriba de la lista aparece un aviso con los comercios cuya prueba vence en los próximos 3 días y los que ya se suspendieron por vencimiento, cada uno con **Renovar**. En la fila de cada cliente está también **Renovar prueba** (o **Poner vencimiento** si no tiene). `pages/Platform/TrialDialog.jsx` permite elegir **hasta una fecha** (vence al terminar ese día) o **sin vencimiento**. Si la prueba ya venció, **Reactivar** abre ese mismo recuadro.
- **Plataforma:** al crear un comercio o reinvitar, se envía el mail con el link y se muestra además para copiarlo y compartirlo por WhatsApp.
- **Menú en el celular:** se muestra como menú hamburguesa (barra superior con botón, y panel lateral con fondo oscurecido).
- **Exportar mis datos** (`/exportar`, solo `admin`): descarga un Excel con todos los datos del comercio. Está en el menú. Se promete en los términos como parte de la gratuidad y de la baja. Tiene un límite de 5 descargas por hora, y de a una por comercio.
- **Baja de comercios** (superadmin, en `/plataforma`):
  - "Dar de baja" pide escribir el nombre exacto del comercio; el comercio queda "En baja" con la fecha de eliminación (30 días).
  - "Cancelar baja" lo devuelve a activo.
  - Durante la baja, el `admin` del comercio solo ve `/exportar` (el layout redirige) y el resto de los usuarios no puede ingresar.
- **Autorización de descuentos** (Remitos, rol `operador`): si el remito tiene un descuento o un precio distinto al de lista o al promocional, al generar se abre `pages/Orders/ApprovalDialog.jsx` con el resumen de lo que hay que autorizar. Un administrador o editor escribe ahí su email y contraseña; con eso se genera el remito. Si el servidor responde `APPROVAL_REQUIRED` (venció o cambió algo), se vuelve a pedir. Los productos inactivos no aparecen en el buscador ni se agregan escaneando.
- **Remitos y compras:** la lista muestra el **N°** de remito (correlativo por comercio, `utils/orderNumber.js`) y, debajo de la fecha, quién lo hizo. El historial de stock de cada producto muestra el usuario de cada movimiento. Los precios se redondean a centavos antes de calcular, igual que el servidor.
- **Listados por período** (Remitos y Compras): se muestran los **últimos 30 días**. Arriba de la tabla, `components/common/DateRangeFilter.jsx` permite elegir otro período (los mismos atajos que Reportes, o fechas a mano, hasta un año) con el botón **Ver**. Al crear o anular, la lista se vuelve a pedir con el período elegido.
- **Compras:** admin y editor tienen el botón **Anular** en cada compra (resta el stock que sumó; las anuladas quedan tachadas con la etiqueta "Anulada"). Si se carga una factura que ya estaba registrada para ese proveedor, se pregunta antes de cargarla otra vez.
- **Importar** (`/imports`): cada tipo tiene un link "descargar planilla de ejemplo" (CSV con punto y coma y BOM, para que Excel en castellano lo abra en columnas) y la ayuda de qué acepta cada columna. Si alguna fila tiene errores no se importa nada y se muestra la tabla de filas a corregir; las filas que ya existían se muestran aparte como salteadas.
- **Derechos sobre los datos de clientes** (`admin`, en Clientes): botón "Exportar datos" (pedido de acceso) y "Anonimizar" (pedido de supresión; conserva los remitos del cliente). Un cliente anonimizado muestra la etiqueta "Anonimizado", ya no se puede editar ni anonimizar de nuevo, y no aparece para elegir en Remitos.
- **CUIT** (Clientes y Proveedores): se valida al escribirlo, con el dígito verificador (`utils/taxId.js`, igual que el servidor). En clientes también se acepta un DNI. Al editar, el CUIT que ya tenía se acepta aunque sea de antes de la validación.
- **Contraseñas:** además del largo, se rechazan las fáciles de adivinar y las que contienen el nombre o el email de la persona (`utils/passwordStrength.js`, el mismo archivo que en el backend).

## Tests
`npm test` corre las pruebas de `test/` con el corredor que viene con Node (`node --test`): lectura de etiquetas de balanza (`utils/scale.js`) y cantidades (`utils/quantity.js`). El cálculo de IVA se compara con el del backend en las pruebas del backend. GitHub Actions las corre en cada push, junto con la compilación (ver README del backend → Tests).

## Estilos
Casi todo el CSS está en `src/index.css`; algunas pantallas tienen su propio archivo (por ejemplo, `pages/Export/ExportData.css`). Los colores y tamaños se definen como variables en `:root` (`--color-primary`, `--color-text`, `--color-border`, `--color-danger`, `--color-success`, `--color-warning`, etc.): **usar siempre las variables**, no colores sueltos.

## Cuenta demo
Si el comercio es de tipo demo, el menú oculta Importar y Usuarios y se muestra un aviso de que no deben cargarse datos reales. La demo no se puede dar de baja.

## Textos legales
Se editan en `src/legal/legalContent.js`. Hoy están en borrador (`LEGAL_VERSION = '2026-10-borrador-1'`, `LEGAL_IS_DRAFT = true`) hasta que los valide el abogado. La casilla de contacto es `hola@talarix.com.ar`. Al cambiarlos:
1. Subir `LEGAL_VERSION`.
2. Subir también la misma versión en `backend/src/utils/legal.js`. Si no coinciden, la activación de cuentas falla a propósito.
3. Poner `LEGAL_IS_DRAFT = false` cuando estén validados.

## Despliegue
- Rama `staging` → vista previa de Vercel (URL fija de la rama).
- Rama `main` → producción.
- `vercel.json` redirige todas las rutas a `index.html` (SPA) y agrega los **encabezados de seguridad**:
  - `Content-Security-Policy`: el sitio solo carga sus propios archivos y solo se conecta con el backend (`*.talarix.com.ar` y `*.up.railway.app`). Si el backend se muda a otro dominio, o se agrega un servicio externo (por ejemplo, Sentry en el frontend), **hay que sumarlo a `connect-src`** o el navegador lo bloquea.
  - `X-Frame-Options: DENY` y `frame-ancestors 'none'` (no se puede meter la app dentro de otra página), `Referrer-Policy: no-referrer`, `X-Content-Type-Options`, `Strict-Transport-Security` y `Permissions-Policy` (solo la cámara, para el escáner).
- **Tipografías propias:** DM Sans, DM Mono y Plus Jakarta Sans vienen de los paquetes `@fontsource/*` (importados en `main.jsx`), no de Google Fonts.
- **Links de los mails:** `hooks/useUrlToken.js` lee el `?token=` de activar y restablecer contraseña y lo borra de la barra de direcciones apenas lo lee (no queda en el historial). Si la persona recarga esa página, tiene que volver a abrir el link del mail.
- Si se agrega una dependencia, subir `package.json` y `package-lock.json` juntos.
- Orden recomendado cuando hay cambios en ambos lados: primero el backend, después el frontend.

Flujo de trabajo, cambios en la base y variables del servidor: ver el README del backend. Recordá hacer `git add` y `commit` desde la **raíz del repo**.

---
Última actualización: 27/10/2026 (listados por período, prueba gratis en /plataforma, avisos de la balanza, limpieza de comentarios).