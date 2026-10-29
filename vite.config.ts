import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Served from https://nadz87.github.io/vaksin-app/ (GitHub Pages project site).
const BASE = '/vaksin-app/'

export default defineConfig({
  base: BASE,
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Browser-first: no install prompt. The service worker only speeds up
      // repeat visits; a toast asks to refresh when a new version is ready.
      registerType: 'prompt',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Vaksin App',
        short_name: 'Vaksin App',
        description: 'Temujanji kesihatan sekolah / School health appointments',
        lang: 'ms',
        theme_color: '#2F6FED',
        background_color: '#F4F6FB',
        display: 'standalone',
        scope: BASE,
        start_url: BASE,
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
      },
    }),
  ],
})
