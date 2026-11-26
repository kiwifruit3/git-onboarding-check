import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API_PORT = Number(process.env.PORT || 8787)

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  server: {
    port: 5273,
    strictPort: false,
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${API_PORT}`,
        changeOrigin: true,
      },
    },
  },
})
