import inertia from '@inertiajs/vite';
import { wayfinder } from '@laravel/vite-plugin-wayfinder';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import laravel from 'laravel-vite-plugin';
import { bunny } from 'laravel-vite-plugin/fonts';
import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        // In the dev container (VITE_DOCKER=1) bind all interfaces and route HMR
        // through the published localhost:5173; on the host keep IPv4 localhost.
        host: process.env.VITE_DOCKER ? '0.0.0.0' : '127.0.0.1',
        cors: true,
        ...(process.env.VITE_DOCKER
            ? {
                  hmr: { host: 'localhost', clientPort: 5173 },
                  // inotify events don't cross the bind mount on macOS/Docker.
                  watch: { usePolling: true },
              }
            : {}),
    },
    plugins: [
        laravel({
            input: ['resources/css/app.css', 'resources/js/app.ts'],
            refresh: true,
            fonts: [
                bunny('Instrument Sans', {
                    weights: [400, 500, 600],
                }),
            ],
        }),
        inertia(),
        tailwindcss(),
        vue({
            template: {
                transformAssetUrls: {
                    base: null,
                    includeAbsolute: false,
                },
            },
        }),
        wayfinder({
            formVariants: true,
        }),
    ],
});
