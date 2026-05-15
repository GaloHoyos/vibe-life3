import { defineConfig } from 'vite';

const srcUrl = new URL('./src/', import.meta.url);

const aliasFor = (segment: string): string =>
  new URL(segment, srcUrl).pathname;

export default defineConfig({
  resolve: {
    alias: {
      '@engine': aliasFor('engine'),
      '@game': aliasFor('game'),
      '@shared': aliasFor('shared'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
});
