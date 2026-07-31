/**
 * Genera los íconos de la app (PWA) a partir de un SVG del rayo de Thunder.
 * Rayo amarillo (#ffd100) sobre fondo casi-negro (#0a0a0b, el mismo del tema).
 *
 * Correr con: node scripts/make-icons.mjs
 * Escribe en public/: icon.svg, manifest.webmanifest y public/icons/*.png
 */
import { Resvg } from '@resvg/resvg-js'
import { mkdirSync, writeFileSync } from 'node:fs'

const BG = '#0a0a0b'
const BOLT = '#ffd100'

// El rayo (path de 24 unidades) escalado y centrado en un lienzo de 512×512.
// Queda a ~66% de alto: sobra margen para el recorte "maskable" de Android.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${BG}"/>
  <path transform="translate(52,52) scale(17)" d="M7 2v11h3v9l7-12h-4l4-8z" fill="${BOLT}"/>
</svg>`

mkdirSync('public/icons', { recursive: true })

const png = (size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
const out = [
  ['public/icons/icon-192.png', 192],
  ['public/icons/icon-512.png', 512],
  ['public/icons/icon-maskable-512.png', 512],
  ['public/icons/apple-touch-icon.png', 180],
  ['public/icons/favicon-32.png', 32],
  ['public/icons/favicon-16.png', 16],
]
for (const [file, size] of out) {
  writeFileSync(file, png(size))
  console.log('escrito', file, `(${size}px)`)
}

writeFileSync('public/icon.svg', svg)
console.log('escrito public/icon.svg')

const manifest = {
  name: 'Thunder · POS Zapatillas',
  short_name: 'Thunder',
  description: 'Punto de venta Thunder',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  orientation: 'portrait',
  background_color: BG,
  theme_color: BG,
  icons: [
    { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: '/icon.svg', type: 'image/svg+xml' },
  ],
}
writeFileSync('public/manifest.webmanifest', JSON.stringify(manifest, null, 2))
console.log('escrito public/manifest.webmanifest')
