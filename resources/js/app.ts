import { createInertiaApp } from '@inertiajs/vue3';
import { configureEcho } from '@laravel/echo-vue';
import { initializeTheme } from '@/composables/useAppearance';
import AppLayout from '@/layouts/AppLayout.vue';
import AuthLayout from '@/layouts/AuthLayout.vue';
import SsSettingsLayout from '@/layouts/settings/SsSettingsLayout.vue';
import SmartStarsLayout from '@/layouts/SmartStarsLayout.vue';
import { initializeFlashToast } from '@/lib/flashToast';

// Laravel Echo (Reverb) — reads VITE_REVERB_* from the env. Powers live OnlyFans
// inbound messages on the Conversations view via private per-creator channels.
configureEcho({
    broadcaster: 'reverb',
});

const appName = import.meta.env.VITE_APP_NAME || 'Laravel';

createInertiaApp({
    title: (title) => (title ? `${title} - ${appName}` : appName),
    layout: (name) => {
        switch (true) {
            case name === 'Welcome':
                return null;
            case name.startsWith('auth/'):
            case name === 'PasswordChange':
                return AuthLayout;
            case name.startsWith('settings/'):
                return [SmartStarsLayout, SsSettingsLayout];
            // SmartStars CRM views use the design shell.
            case name === 'Dashboard':
            case name === 'Analytics':
            case name === 'AiUsage':
            case name === 'Conversations':
            case name === 'Models':
            case name === 'ModelShow':
            case name === 'Team':
            case name === 'DevGenerate':
                return SmartStarsLayout;
            default:
                return AppLayout;
        }
    },
    progress: {
        color: '#4B5563',
    },
});

// This will set light / dark mode on page load...
initializeTheme();

// This will listen for flash toast data from the server...
initializeFlashToast();
