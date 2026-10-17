import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  build: {
    // les polices restent des fichiers separes : la CSP (font-src 'self') bloque les polices integrees en data:
    assetsInlineLimit: (file) => (file.endsWith('.woff2') || file.endsWith('.woff') ? false : undefined),
  },
  plugins: [
    react(),
    // Application installable (PWA) : icone sur l'ecran d'accueil, plein ecran, demarrage meme avec un reseau faible.
    // Seuls les fichiers de l'app sont mis en cache ; les donnees Supabase passent toujours par le reseau.
    VitePWA({
      registerType: 'autoUpdate',
      // fichier registerSW.js separe (pas de script en ligne) : compatible avec la CSP de vercel.json
      injectRegister: 'script',
      includeAssets: ['favicon.ico', 'favicon.svg', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Cercly',
        short_name: 'Cercly',
        description: 'Les cotisations de votre groupe, claires pour tout le monde.',
        lang: 'fr',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#eaf3ff',
        theme_color: '#5eaeff',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        cleanupOutdatedCaches: true,
      },
    }),
  ],
})
