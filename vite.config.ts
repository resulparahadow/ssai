import inertia from '@inertiajs/vite';
import { wayfinder } from '@laravel/vite-plugin-wayfinder';
import tailwindcss from '@tailwindcss/vite';
import vue from '@vitejs/plugin-vue';
import laravel from 'laravel-vite-plugin';
import { bunny } from 'laravel-vite-plugin/fonts';
import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        // Pin the dev server to IPv4 localhost so the generated asset URLs are stable
        // (otherwise Vite may advertise http://[::1]:5173, which mismatches the app's
        // localhost/127.0.0.1 origin and trips CORS).
        host: '127.0.0.1',
        // The app (port 8000 / *.test) and Vite (5173) are always different origins, so
        // the dev module scripts are cross-origin. Vite 6+/v8 locks CORS to localhost by
        // default; reflect the request origin in dev so any local host form works.
        cors: true,
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
