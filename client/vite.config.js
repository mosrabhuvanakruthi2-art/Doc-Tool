import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    host: true,
    allowedHosts: ['rookiest-unfrictionally-yi.ngrok-free.dev'],
    proxy: {
      '/api': 'http://localhost:5000',
      '/assets': 'http://localhost:5000',
    },
  },
});
