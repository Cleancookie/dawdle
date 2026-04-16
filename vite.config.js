import { defineConfig } from 'vite';
import laravel from 'laravel-vite-plugin';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.jsx'],
            refresh: true,
        }),
        tailwindcss(),
        react(),
    ],
    server: {
        host: '0.0.0.0',  // listen on all interfaces inside Docker
        port: 5173,
        hmr: {
            host: 'localhost',  // browser connects HMR websocket to localhost
        },
        watch: {
            ignored: ['**/storage/framework/views/**'],
        },
    },
});
