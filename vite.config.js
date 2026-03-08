import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
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
  server: {
    port: 5173,
    proxy: {
      '/src/api': {
        target: 'http://localhost:8081',
        changeOrigin: true,
      },
    },
  },
});
