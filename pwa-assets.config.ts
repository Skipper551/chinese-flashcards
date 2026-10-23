import { defineConfig, minimal2023Preset } from '@vite-pwa/assets-generator/config';

// Run `npm run icons` after changing public/favicon.svg to regenerate the PNG icons.
export default defineConfig({
  preset: {
    ...minimal2023Preset,
    maskable: { ...minimal2023Preset.maskable, resizeOptions: { background: '#faf6ef' } },
    apple: { ...minimal2023Preset.apple, resizeOptions: { background: '#faf6ef' } },
  },
  images: ['public/favicon.svg'],
});
