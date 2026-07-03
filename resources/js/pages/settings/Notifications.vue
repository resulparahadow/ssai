<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { notificationPrefs } from '@/lib/notificationPrefs';
import { playBing } from '@/lib/sound';

function testSound() {
    playBing(notificationPrefs.volume);
}
</script>

<template>
    <Head title="Notification settings" />

    <h1 class="sr-only">Notification settings</h1>

    <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
        <div class="mb-5">
            <h3 class="text-sm font-semibold text-ss-text">
                Notification settings
            </h3>
            <p class="text-sm text-ss-text-2">
                Choose how you're alerted when a new message arrives. These
                preferences are saved on this device.
            </p>
        </div>

        <div class="space-y-6">
            <div class="flex items-start gap-3">
                <Checkbox
                    id="show-toast"
                    v-model="notificationPrefs.showToast"
                    class="mt-0.5"
                />
                <div class="grid gap-1">
                    <Label for="show-toast" class="text-ss-text"
                        >Show notification</Label
                    >
                    <p class="text-sm text-ss-text-2">
                        Pop an in-app toast with the fan's name and message
                        preview.
                    </p>
                </div>
            </div>

            <div class="flex items-start gap-3">
                <Checkbox
                    id="play-sound"
                    v-model="notificationPrefs.playSound"
                    class="mt-0.5"
                />
                <div class="grid gap-1">
                    <Label for="play-sound" class="text-ss-text"
                        >Play sound</Label
                    >
                    <p class="text-sm text-ss-text-2">
                        Play a short chime on each new message. Turn off to
                        mute.
                    </p>
                </div>
            </div>

            <div
                class="grid gap-2"
                :class="
                    notificationPrefs.playSound
                        ? ''
                        : 'pointer-events-none opacity-50'
                "
            >
                <Label for="volume" class="text-ss-text">Sound volume</Label>
                <div class="flex items-center gap-3">
                    <input
                        id="volume"
                        v-model.number="notificationPrefs.volume"
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        class="h-2 w-56 cursor-pointer accent-ss-accent"
                    />
                    <span class="w-10 text-sm text-ss-text-2"
                        >{{ Math.round(notificationPrefs.volume * 100) }}%</span
                    >
                    <button
                        type="button"
                        class="rounded-lg border border-ss-border px-3 py-1 text-sm text-ss-text-2 hover:bg-ss-surface-2"
                        @click="testSound"
                    >
                        Test
                    </button>
                </div>
            </div>
        </div>
    </div>
</template>
