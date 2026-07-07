<script setup lang="ts">
import { Bell, BellOff } from '@lucide/vue';
import { onBeforeUnmount, ref } from 'vue';
import { notificationPrefs } from '@/lib/notificationPrefs';
import { playBing } from '@/lib/sound';

const open = ref(false);
const root = ref<HTMLElement | null>(null);

function onDocClick(e: MouseEvent) {
    if (root.value && !root.value.contains(e.target as Node)) {
        open.value = false;
    }
}

function toggle() {
    open.value = !open.value;

    if (open.value) {
        document.addEventListener('click', onDocClick);
    } else {
        document.removeEventListener('click', onDocClick);
    }
}

onBeforeUnmount(() => document.removeEventListener('click', onDocClick));

// Whether any alert is on — drives the bell icon state.
const muted = () =>
    !notificationPrefs.showToast && !notificationPrefs.playSound;
</script>

<template>
    <div ref="root" class="relative">
        <button
            type="button"
            class="grid h-7 w-7 place-items-center rounded-md text-ss-text-2 hover:bg-ss-surface-2"
            :title="muted() ? 'Notifications muted' : 'Notification settings'"
            @click.stop="toggle"
        >
            <component :is="muted() ? BellOff : Bell" :size="14" />
        </button>

        <div
            v-if="open"
            class="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-ss-border bg-ss-surface p-1.5 shadow-lg"
        >
            <p
                class="px-2 pt-1 pb-1.5 text-[10px] font-semibold tracking-wide text-ss-text-3 uppercase"
            >
                New message alerts
            </p>

            <label
                class="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-ss-surface-2"
            >
                <span class="text-[13px] text-ss-text">Show notification</span>
                <button
                    type="button"
                    role="switch"
                    :aria-checked="notificationPrefs.showToast"
                    class="relative h-4 w-7 shrink-0 rounded-full transition-colors"
                    :class="
                        notificationPrefs.showToast
                            ? 'bg-ss-accent'
                            : 'bg-ss-border'
                    "
                    @click="
                        notificationPrefs.showToast =
                            !notificationPrefs.showToast
                    "
                >
                    <span
                        class="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
                        :class="
                            notificationPrefs.showToast
                                ? 'left-3.5'
                                : 'left-0.5'
                        "
                    />
                </button>
            </label>

            <label
                class="flex cursor-pointer items-center justify-between gap-2 rounded-md px-2 py-1.5 hover:bg-ss-surface-2"
            >
                <span class="text-[13px] text-ss-text">Sound</span>
                <button
                    type="button"
                    role="switch"
                    :aria-checked="notificationPrefs.playSound"
                    class="relative h-4 w-7 shrink-0 rounded-full transition-colors"
                    :class="
                        notificationPrefs.playSound
                            ? 'bg-ss-accent'
                            : 'bg-ss-border'
                    "
                    @click="
                        notificationPrefs.playSound =
                            !notificationPrefs.playSound;
                        notificationPrefs.playSound &&
                            playBing(notificationPrefs.volume);
                    "
                >
                    <span
                        class="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
                        :class="
                            notificationPrefs.playSound
                                ? 'left-3.5'
                                : 'left-0.5'
                        "
                    />
                </button>
            </label>

            <a
                href="/settings/notifications"
                class="mt-1 block rounded-md px-2 py-1.5 text-[12px] text-ss-accent-text hover:bg-ss-surface-2"
            >
                More settings…
            </a>
        </div>
    </div>
</template>
