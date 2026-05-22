import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        allowedHosts: [
            "ec5c-196-188-160-46.ngrok-free.app",
            ".ngrok-free.app",
            ".ngrok.io",
        ],
    },
});
// https://6366-196-188-176-96.ngrok-free.app
