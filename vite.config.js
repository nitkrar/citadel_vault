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
          start_url: '/',
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
            'charts': ['recharts'],
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
      include: ['tests/unit/**/*.test.js'],
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
