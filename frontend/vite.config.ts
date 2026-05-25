import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],

  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          const match = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
          return match ? `vendor.${match[1].replace('@', '').replace('/', '.')}` : 'vendor';
        },
      },
    },
  },

  test: {
    environment: 'jsdom',
    setupFiles: ['./src/vitest-setup.ts'],
    globals: true,
  },
})
