# Thunder POS · Zapatillas

Punto de venta para una tienda de zapatillas con **dos locales (163 y 173) que
comparten una bodega central única**. Registra ventas, compras (reabastecer) y
devoluciones escaneando el código de barras, y mantiene inventario, historial y
dashboard en tiempo real sobre Firestore.

Reproduce el diseño hecho en Claude Design, con una arquitectura de datos y de
proyecto pensada para mantenerse en el tiempo.

---

## Ver solo el front, sin Firebase (modo demo)

Para mirar la interfaz ya, sin configurar nada:

```bash
npm install
npm run dev:demo      # http://localhost:5173
```

Arranca **sin login y con datos de ejemplo en memoria**: entras directo como un
socio de prueba, puedes navegar todo (escanear, vender, inventario, historial,
dashboard, equipo, perfil) y los cambios se ven en vivo, pero **no se guardan**
(al recargar vuelve al estado inicial). Para previsualizar la vista de
**empleado**, cambia `role: 'socio'` a `'empleado'` en `src/data/demoBackend.ts`.

Cuando quieras la app real (con login y datos que persisten), sigue la sección
de abajo y usa `npm run dev`.

## Puesta en marcha real (verla por primera vez con Firebase)

Necesitas Node 20+ y una cuenta de Firebase (el plan gratis _Spark_ alcanza).

### 1. Crear el proyecto de Firebase

1. En [console.firebase.google.com](https://console.firebase.google.com) crea un
   proyecto nuevo.
2. **Firestore Database** → _Crear base de datos_ (modo producción).
3. **Authentication** → _Sign-in method_ → habilita **Correo/contraseña**.
4. **Configuración del proyecto** → _Tus apps_ → registra una app **Web** y copia
   el bloque de configuración del SDK.

### 2. Configurar credenciales

```bash
cp .env.example .env
```

Pega en `.env` los valores de tu app web. `.env` está en `.gitignore` y nunca se
sube.

### 3. Instalar y publicar reglas e índices

```bash
npm install
npm i -g firebase-tools      # una sola vez
firebase login
firebase use --add           # elige tu proyecto
firebase deploy --only firestore:rules,firestore:indexes
```

> Los índices tardan unos minutos la primera vez. Si una consulta falla con un
> enlace "create index", es que aún no terminó.

### 4. Correr, registrarte y sembrar

```bash
npm run dev       # http://localhost:5173
```

1. Crea la primera cuenta **como prefieras**:
   - **Desde la app**: abre `localhost:5173` y toca "Crear una". Como eres la
     primera cuenta, quedas como **socio dueño** sin pedir invitación.
   - **Desde la consola de Firebase** (Authentication → Users → _Add user_):
     creas el correo y la contraseña ahí y luego inicias sesión en la app. La
     primera vez que entres, si la plataforma está vacía, la app te asigna sola
     el rol de **socio dueño**.
2. Verás la pantalla de locales vacía ("corre npm run seed"). Pon en `.env` ese
   mismo correo y contraseña en `SEED_EMAIL` / `SEED_PASSWORD` y ejecuta:

   ```bash
   npm run seed   # crea los 2 locales, 20 referencias y su stock inicial
   ```
3. Recarga la app: elige un local y a operar.

El seed **no** crea movimientos: el libro mayor arranca limpio y el dashboard se
llena con ventas reales.

### Invitar a socios y empleados

Ya como socio, entra a **Equipo** → genera un código de invitación con el rol que
quieras (empleado o socio) y compártelo. Quien se registre con ese código hereda
ese rol y **no puede cambiarlo**. Un empleado no ve la pestaña Equipo ni puede
invitar, así que no puede ascenderse.

### Publicarla en internet (para que todos entren desde cualquier lado)

```bash
npm run build
firebase deploy --only hosting     # requiere: firebase init hosting (carpeta dist)
```

También sirve subir el repo a GitHub y conectarlo a Vercel o Netlify (carpeta de
salida `dist`, comando `npm run build`), poniendo las variables `VITE_*` en el
panel del servicio.

---

## Códigos de barras: crearlos, escanearlos e imprimirlos

**Los códigos los crea la app, no se compran.** Al guardar una referencia en
*Inventario → Crear referencia*, cada talla recibe su propio código con el
formato `SKU-TALLA` (por ejemplo `AM90-BLK-40`). Es único por talla a propósito:
así el stock baja en la talla correcta y no en "el modelo".

**Imprimirlos en sticker.** En esa misma pantalla, el botón **Imprimir
etiquetas** abre una hoja lista para imprimir, con una etiqueta de **50 × 25 mm**
por cada talla seleccionada (y tantas copias por talla como pongas en *Stickers
por talla*). Sirven dos caminos:

- **Impresora térmica de etiquetas** (Zebra, Xprinter, Brother QL y similares,
  desde ~$300.000): se carga el rollo de 50 × 25 mm y se imprime directo. Es lo
  recomendable si etiquetas todos los días.
- **Impresora normal + hoja A4 de stickers adhesivos**: se imprime la hoja y se
  recortan. Cero inversión, más trabajo manual.

En el diálogo de impresión hay que dejar la escala en **100 %** (no "ajustar a la
página") para que los milímetros salgan exactos.

**Escanearlos.** Hay tres formas, y todas terminan en el mismo campo de la
pantalla *Escanea producto*:

1. **Lector USB** (~$100.000). Es lo que usa una caja de verdad: se conecta al
   computador, se comporta como un teclado y "escribe" el código en el campo y
   manda Enter. No hay que instalar nada ni configurar la app.
2. **Cámara del celular.** El botón **Cámara** abre la cámara trasera y lee la
   etiqueta. Usa `BarcodeDetector`, el lector que trae el propio navegador:
   funciona en **Chrome de Android** y en Chrome/Edge de escritorio, pero **no en
   Safari de iPhone**, que todavía no lo trae. Si el navegador no lo soporta, el
   botón no aparece. Además exige **HTTPS** — el hosting de Firebase ya lo es.
3. **A mano**, escribiendo el código o buscando por nombre de la referencia.

---

## Scripts

| Comando              | Qué hace                                                        |
| -------------------- | -------------------------------------------------------------- |
| `npm run dev`        | Servidor de desarrollo (Vite).                                 |
| `npm run build`      | Chequeo de tipos + build de producción.                        |
| `npm run preview`    | Sirve el build de producción.                                  |
| `npm run typecheck`  | Solo TypeScript, sin emitir.                                   |
| `npm run lint`       | ESLint (0 warnings permitidas).                                |
| `npm run seed`       | Siembra locales + catálogo + stock inicial en tu Firestore.    |
| `npm run emulators`  | Levanta los emuladores de Firestore y Auth para pruebas.       |

Para trabajar contra los emuladores, pon `VITE_USE_EMULATORS=true` en `.env`.

---

## Arquitectura

Tres capas, con dependencias siempre hacia adentro (la UI conoce el dominio, el
dominio no conoce a nadie):

```
  src/domain/     Reglas y tipos puros del negocio. Sin React, sin Firebase.
       ▲
  src/data/       Traducción a Firestore: paths, converters, repositorios.
       ▲
  src/app/ + src/screens/ + src/ui/    React: pantallas, hooks, tokens.
```

### Dominio (`src/domain`)

- `models.ts` — tipos del negocio con **branded types** (un `ProductId` no se
  puede pasar donde va un `VariantId`) y **dinero en centavos enteros** para no
  acumular error de coma flotante.
- `rules.ts` — cálculo de cada movimiento, validación de stock, estados de
  inventario, códigos de barras y tokens de búsqueda. Funciones puras.

### Datos (`src/data`)

- `firebase.ts` — único punto de init. Caché persistente en IndexedDB (el POS
  sigue operando con wifi inestable) y sesión anónima.
- `paths.ts` — **todas** las rutas de Firestore en un solo lugar.
- `converters.ts` — única frontera con `Timestamp`/snapshots.
- `repositories/` — una fachada por área (catálogo, movimientos, stats, locales).

### Modelo de datos en Firestore

```
stores/{storeId}                      Locales (163, 173)
products/{productId}                  Referencia (modelo). NO guarda stock.
products/{productId}/variants/{size}  Talla. AQUÍ vive el stock (compartido).
barcodes/{barcode}                    Índice inverso código → talla (scan O(1)).
movements/{movementId}                Libro mayor inmutable (firmado por uid).
dailyStats/{dayKey}                   Agregado diario del dashboard.
users/{uid}                           Persona + rol (socio | empleado).
invites/{code}                        Invitación de un solo uso con rol fijo.
system/state                          Centinela de arranque (¿ya hay dueño?).
```

Decisiones clave frente a un prototipo con "un documento con mapa de tallas":

- **Variantes como subcolección.** Vender la talla 40 y la 42 de la misma
  referencia a la vez son dos documentos distintos: no compiten por la misma
  escritura. Habilita alertas de stock bajo con `collectionGroup` en una sola
  consulta, y respeta el límite de 1 MiB por documento.
- **Libro mayor inmutable + proyecciones.** Cada venta/compra/devolución es un
  asiento que nunca se edita; `Variant.stock` y `dailyStats` son proyecciones
  que la **misma transacción** mantiene con `increment()`. El dashboard lee ~7
  documentos, no miles de movimientos: su costo no crece con el histórico.
- **Stock a prueba de carreras.** La transacción vuelve a leer el stock del
  servidor y revalida antes de escribir: si dos cajas venden el último par a la
  vez, la segunda se rechaza en vez de dejar el stock en −1.
- **`dayKey` en horario de Colombia** (America/Bogota) vía `Intl`, no
  `toISOString()`: las ventas de la tarde no se parten en dos días.

### Seguridad y roles

- Cada persona inicia sesión con **correo y contraseña**. El **rol vive en
  `users/{uid}`** y lo leen las reglas — nunca se confía en el cliente.
- **Socio**: ve costos y utilidad, gestiona el equipo (invita gente), opera todo.
  **Empleado**: vende, devuelve, ingresa mercancía, cuadra y crea referencias,
  pero **no ve costos/utilidad ni gestiona el equipo**.
- **Registro por invitación.** El primer registro es el socio dueño (arranque).
  Después, registrarse exige un **código de invitación** con el rol ya fijado por
  un socio; las reglas verifican que el rol del perfil coincida con la invitación,
  así **un empleado no puede ascenderse a socio**. Solo los socios crean códigos.
- El **libro mayor es inmutable** a nivel de reglas (crear y leer, nunca editar ni
  borrar) y cada asiento queda **firmado con el uid real** de quien lo hizo.
- **Límite honesto sobre costos**: el costo vive dentro del documento del
  producto y la app lo oculta a los empleados en la interfaz, pero una regla no
  puede ocultar un campo suelto — un empleado con conocimientos técnicos podría
  leerlo inspeccionando la app. Para ocultarlo de verdad hay que separarlo en una
  colección legible solo por socios y calcular la utilidad en el servidor (Cloud
  Functions, plan Blaze). Es una mejora futura, no un bloqueo para operar.

### UI (`src/ui`, `src/app`, `src/screens`)

- `ui/tokens.css` — tokens del sistema de diseño extraídos 1:1 del original.
- `app/` — sesión, flujo de escaneo, armazón responsivo (nav inferior en móvil,
  lateral en escritorio), hooks sobre los repositorios.
- `screens/` — una pantalla por archivo, cada una leyendo/escribiendo datos
  reales: escaneo, resultado, compra, venta/devolución, confirmación, inventario,
  nueva referencia, historial y dashboard.

> En una caja real el lector de código de barras USB actúa como teclado: escribe
> el código en el campo enfocado y envía Enter. Por eso la pantalla de escaneo es
> un input autoenfocado; también funciona a mano o tocando un código de ejemplo.
