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
            'binastech.com'
        ],
    },
});
// https://6366-196-188-176-96.ngrok-free.app
