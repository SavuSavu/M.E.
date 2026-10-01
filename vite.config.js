import { defineConfig } from 'vite';
export default defineConfig({ base: './', worker: { format: 'es' }, build: { assetsInlineLimit: 0 }, test: { include: ['tests/**/*.test.js'] } });
