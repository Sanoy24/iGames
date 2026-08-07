import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        // Service worker whose ONLY job is substituting our own branded
        // "check your connection" page for the browser's native (domain-leaking)
        // error page when a navigation fails offline  see src/sw.ts for the
        // full rationale and why this deliberately does NOT cache the app itself.
        VitePWA({
            strategies: 'injectManifest',
            srcDir: 'src',
            filename: 'sw.ts',
            injectRegister: 'auto',
            registerType: 'autoUpdate',
            manifest: false, // we already ship our own public/site.webmanifest + <link> tags
            injectManifest: {
                globPatterns: ['offline.html'],
            },
            devOptions: { enabled: false },
        }),
    ],
    build: {
        rollupOptions: {
            output: {
                manualChunks(id) {
                    if (!id.includes('node_modules')) return undefined;
                    if (
                        id.includes('react-dom') ||
                        id.includes('/react/') ||
                        id.includes('scheduler')
                    )
                        return 'vendor-react';
                    if (id.includes('framer-motion')) return 'vendor-motion';
                    if (id.includes('socket.io') || id.includes('engine.io'))
                        return 'vendor-socket';
                    if (id.includes('i18next')) return 'vendor-i18n';
                    return 'vendor';
                },
            },
        },
    },
    server: {
        proxy: {
            // All REST API calls  strip /api prefix before forwarding
            '/api': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                rewrite: (path) => path.replace(/^\/api/, ''),
            },
            // Socket.IO  forward both HTTP polling and WebSocket upgrades
            '/socket.io': {
                target: 'http://localhost:3000',
                changeOrigin: true,
                ws: true,
            },
        },
    },
});
