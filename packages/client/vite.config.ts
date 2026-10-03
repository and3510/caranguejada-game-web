import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // Em dev o Vite serve o cliente e repassa o WebSocket para o servidor do jogo.
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Phaser muda pouco entre deploys: chunk separado aproveita melhor o cache.
        manualChunks: (id) => (id.includes('node_modules/phaser') ? 'phaser' : undefined),
      },
    },
  },
});
