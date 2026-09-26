import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // The API owns /assets (uploaded screenshots and documents), so the bundle
    // goes to /static instead of colliding with it behind nginx.
    assetsDir: 'static',
    rollupOptions: {
      output: {
        // The pdf.js worker ships as a .mjs file. nginx's default MIME table does not
        // know .mjs and serves it as application/octet-stream, which browsers refuse
        // to run as a (module) worker, so PDFs failed to render in production while
        // working in dev. Emitting .mjs assets as .js makes nginx send JavaScript.
        assetFileNames: (info) => {
          const name = (info.names && info.names[0]) || info.name || '';
          return name.endsWith('.mjs') ? 'static/[name]-[hash].js' : 'static/[name]-[hash][extname]';
        },
      },
    },
  },
  server: {
    port: 4002,
    strictPort: true,
    host: true,
    allowedHosts: ['rookiest-unfrictionally-yi.ngrok-free.dev'],
    proxy: {
      '/api': 'http://localhost:5001',
      '/assets': 'http://localhost:5001',
    },
  },
});
