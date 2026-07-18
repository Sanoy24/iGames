import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vite.dev/config/
export default defineConfig({
    plugins: [react(), tailwindcss()],
    build: {
        rollupOptions: {
            output: {
                // Split large, rarely-changing dependencies into their own chunks so
                // they cache across app deploys (an app-code change won't bust the
                // React/socket/animation vendor code the browser already holds).
                manualChunks(id) {
                    if (!id.includes('node_modules')) return undefined;
                    if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'vendor-react';
                    if (id.includes('framer-motion')) return 'vendor-motion';
                    if (id.includes('socket.io') || id.includes('engine.io')) return 'vendor-socket';
                    if (id.includes('i18next')) return 'vendor-i18n';
                    return 'vendor';
                },
            },
        },
    },
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
            // Uploaded broadcast images served from the backend root
            '/uploads': {
                target: 'http://localhost:3000',
                changeOrigin: true,
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
