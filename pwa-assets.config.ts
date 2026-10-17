import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config'

// Genere les icones de l'app installable a partir de public/icon.svg : npm run icons
export default defineConfig({
  headLinkOptions: { preset: '2023' },
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#ffffff' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#ffffff' } },
  },
  images: ['public/icon.svg'],
})
