import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { nodePolyfills } from 'vite-plugin-node-polyfills'

import { seoFiles } from './src/seo/seoPlugin.ts'


/**
 * Hostnames the dev and preview servers will answer to, beyond localhost.
 *
 * Vite rejects a Host header it does not recognise, which is its defence
 * against DNS rebinding: a page you visit cannot make your browser fetch your
 * dev server and read the source back. A tunnel hostname is exactly such a
 * header, so testing on a real phone needs the tunnel domains listed.
 *
 * A leading dot matches the domain and its subdomains, which is what makes
 * this survive ngrok handing out a different name. Local only either way: the
 * production build is static files and has no server to configure.
 */
const TUNNEL_HOSTS = ['.ngrok-free.dev', '.ngrok.io', '.ngrok.app', '.trycloudflare.com', '.loca.lt']

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Web3 libraries reach for Node globals that a browser does not have.
    // The original reason was `@zerodev/sdk`, which left with the ERC-4337
    // decision; `ethers` and the WalletConnect provider still want `events`
    // and `Buffer`, so the polyfills stay. Deliberately not narrowed further
    // without testing: the failure mode is a runtime crash inside a
    // dependency, not a build error.
    nodePolyfills({ include: ['events', 'buffer', 'util'] }),
    // robots.txt and sitemap.xml, rendered from VITE_PUBLIC_URL and the route
    // list rather than checked in with a hostname baked into them.
    seoFiles(),
  ],

  // `npm run dev -- --host` for the dev server, `npm run preview -- --host`
  // for the built app. The install prompt needs the second one: the service
  // worker only registers in a production build.
  server: { allowedHosts: TUNNEL_HOSTS },
  preview: { allowedHosts: TUNNEL_HOSTS },

  build: {
    // Chunks that exist only for a path most people never take. Vite preloads
    // everything reachable from the entry, dynamic imports included, so the
    // wallet-connection modal was being fetched on page load: 950 kB for a QR
    // code that an organizer with a browser extension never sees, and that no
    // voter ever sees at all. Dropping the preload does not remove the chunk,
    // it just waits until something asks for it.
    modulePreload: {
      resolveDependencies: (_url: string, deps: string[]) =>
        deps.filter(dep => !/reown|walletconnect/.test(dep)),
    },
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return;
          // The wallet-connection stack is left alone on purpose. Forcing one
          // chunk per package fragments its module graph, and the pieces end
          // up statically imported by vendor chunks that DO load eagerly, so
          // the modal arrived on page load through a dependency of Semaphore.
          // Unnamed, the bundler keeps the dynamic import whole and the whole
          // thing waits until someone asks to connect a wallet.
          if (/@reown|@walletconnect/.test(id)) return;
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
