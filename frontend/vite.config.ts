import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), tailwindcss()],
    server: {
        allowedHosts: [
            '261e-196-190-62-169.ngrok-free.app',
            '.ngrok-free.app',
            '.ngrok.io',
            'api.binastech.com',
            'binastech.com',
        ],
        proxy: {
            // All REST API calls — strip /api prefix before forwarding
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, ''),
            },
            // Socket.IO — forward both HTTP polling and WebSocket upgrades
            '/socket.io': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                ws: true,
            },
        },
    },
});
// https://6366-196-188-176-96.ngrok-free.app
