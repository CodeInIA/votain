import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // @zerodev/sdk (KernelEIP1193Provider) extends Node's EventEmitter; without a
    // polyfill Vite stubs `events` as browser-external and the class heritage
    // crashes at runtime. Buffer/util are common web3-SDK needs.
    nodePolyfills({ include: ['events', 'buffer', 'util'] }),
  ],

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
    // e2e/ belongs to Playwright, not Vitest
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
