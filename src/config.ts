/**
 * Interruptor de modo demo.
 *
 * Con `VITE_DEMO_MODE=true` la app corre SIN Firebase: sin login, con datos de
 * ejemplo en memoria. Sirve para ver el front sin configurar nada. Se activa
 * con `npm run dev:demo` (que carga `.env.demo`). En modo normal es `false` y
 * todo va contra Firestore real.
 */
export const DEMO = import.meta.env.VITE_DEMO_MODE === 'true'
