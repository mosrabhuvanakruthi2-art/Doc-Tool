import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    // The API owns /assets (uploaded screenshots and documents), so the bundle
    // goes to /static instead of colliding with it behind nginx.
    assetsDir: 'static',
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
