import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  server: { port: 3100 },
  plugins: [tanstackStart()],
});
