import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  preview: {
    allowedHosts: ['4173-ikavsvw2fvyni446v353q-1894cc2f.sg1.manus.computer'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
})
