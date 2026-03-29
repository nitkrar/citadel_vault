import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'path';

export default defineConfig(({ mode }) => {
  // Load VITE_* env vars from .env so manifest can use them
  const env = loadEnv(mode, '.', 'VITE_');
  const appName = env.VITE_APP_NAME || 'Citadel Vault';
  const appTagline = env.VITE_APP_TAGLINE || 'Zero-knowledge encrypted personal vault';

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        manifest: {
          name: appName,
          short_name: appName.split(' ')[0] || 'Citadel',
          description: appTagline,
          theme_color: '#1a1a2e',
          background_color: '#1a1a2e',
          display: 'standalone',
          orientation: 'any',
          start_url: '/',
          scope: '/',
          categories: ['finance', 'security', 'utilities'],
          icons: [
            { src: '/favicon-192.svg', sizes: '192x192', type: 'image/svg+xml' },
            { src: '/favicon-512.svg', sizes: '512x512', type: 'image/svg+xml' },
            { src: '/favicon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'maskable' },
            { src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          // No API caching — IndexedDB handles data caching.
          // Service worker only caches static assets (app shell).
          navigateFallback: '/index.html',
          // iOS PWA resilience: use NetworkFirst for navigation so the app
          // never serves a stale HTML shell that can't bootstrap.
          // JS/CSS assets use precache (content-hashed, safe to cache forever).
          runtimeCaching: [
            {
              urlPattern: ({ request }) => request.mode === 'navigate',
              handler: 'NetworkFirst',
              options: {
                cacheName: 'html-cache',
                networkTimeoutSeconds: 3,
                plugins: [
                  { cacheWillUpdate: async ({ response }) => response?.status === 200 ? response : null },
                ],
              },
            },
          ],
        },
      }),
    ],
    root: '.',
    publicDir: 'static',
    envDir: '.',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          manualChunks: {
            'react-vendor': ['react', 'react-dom', 'react-router-dom'],
            'charts': ['chart.js', 'react-chartjs-2'],
            'icons': ['lucide-react'],
            'axios': ['axios'],
            'xlsx': ['xlsx'],
          },
        },
      },
      chunkSizeWarningLimit: 1000,
    },
    resolve: {
      alias: { '@': path.resolve(__dirname, 'src/client') },
    },
    test: {
      include: [
        'tests/unit/**/*.test.js',
        'tests/component/**/*.test.{js,jsx}',
      ],
      exclude: ['tests/api-js/**'],
      setupFiles: ['tests/setup.js'],
    },
    server: {
      port: 5173,
      proxy: {
        '/src/api': {
          target: 'http://localhost:8081',
          changeOrigin: true,
        },
      },
    },
  };
});
