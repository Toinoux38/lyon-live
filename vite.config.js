import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://sytral.api.instant-system.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '/InstantCore/v3'),
        headers: {
          'X-API-Key': 'e87bb053f0732c493db02eb4d0848cb6',
        },
      },
    },
  },
})
