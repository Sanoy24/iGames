import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    allowedHosts: [
      '3a63-196-188-160-46.ngrok-free.app',
      '.ngrok-free.app',
      '.ngrok.io'
    ],
  },
})
