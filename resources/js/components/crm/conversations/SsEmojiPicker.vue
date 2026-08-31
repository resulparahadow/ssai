<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';

const emit = defineEmits<{ select: [emoji: string]; close: [] }>();

const root = ref<HTMLElement | null>(null);

/**
 * A curated set, not the full Unicode table: chat emoji use is dominated by a
 * small tail and a hand-rolled list keeps this dep-free and on the ss-* tokens.
 */
const CATEGORIES: { name: string; emoji: string[] }[] = [
    {
        name: 'Smileys',
        emoji: [
            '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
            '😉', '😊', '😇', '😌', '😋', '😛', '😜', '🤪', '😝', '🤗',
            '🤭', '🤫', '🤔', '🤐', '😐', '😑', '😶', '😏', '😒', '🙄',
            '😬', '😮', '😯', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤠',
        ],
    },
    {
        name: 'Flirty',
        emoji: [
            '😍', '🥰', '😘', '😗', '😚', '😙', '🥲', '😻', '💋', '💌',
            '💘', '💝', '💖', '💗', '💓', '💞', '💕', '❤️', '🧡', '💛',
            '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💟', '🥵',
            '🫦', '👀', '😈', '👿', '🔥', '💦', '🍑', '🍆', '👅', '👄',
        ],
    },
    {
        name: 'Feelings',
        emoji: [
            '😔', '😟', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢',
            '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥶', '😱', '😨',
            '😰', '😥', '😓', '🤥', '🫠', '🫥', '😶‍🌫️', '😮‍💨', '🤧', '🤒',
            '🤕', '🤢', '🤮', '🥴', '😷', '🤨', '🧐', '🤓', '😎', '🥸',
        ],
    },
    {
        name: 'Hands',
        emoji: [
            '👍', '👎', '👌', '🤌', '🤏', '✌️', '🤞', '🫰', '🤟', '🤘',
            '🤙', '👈', '👉', '👆', '👇', '☝️', '✋', '🤚', '🖐', '🖖',
            '👋', '🤝', '🙏', '💪', '🦵', '🦶', '👏', '🙌', '👐', '🤲',
            '🫶', '🤛', '🤜', '✊', '👊', '🫵', '💅', '🤳', '💃', '🕺',
        ],
    },
    {
        name: 'Fun',
        emoji: [
            '🎉', '🎊', '🥳', '🎁', '🎈', '🍾', '🥂', '🍻', '🍷', '🍸',
            '🍹', '🍺', '☕', '🍕', '🍔', '🍟', '🌮', '🍿', '🍫', '🍭',
            '🍩', '🍪', '🎂', '🧁', '🍓', '🍒', '🍌', '🍦', '🎵', '🎶',
            '✨', '⭐', '🌟', '💫', '💥', '🌊', '🌈', '☀️', '🌙', '⚡',
        ],
    },
    {
        name: 'Things',
        emoji: [
            '📱', '💻', '⌚', '📷', '🎥', '🎬', '🎮', '🕹️', '🎧', '🎤',
            '💰', '💵', '💸', '💳', '🎁', '📦', '✉️', '📩', '🔒', '🔓',
            '🔑', '⏰', '⏳', '📅', '✅', '❌', '❓', '❗', '💤', '🚀',
            '🏆', '🥇', '🎯', '🎰', '🧸', '👑', '💎', '🌹', '🌺', '🦋',
        ],
    },
];

function onDocClick(e: MouseEvent) {
    if (root.value && !root.value.contains(e.target as Node)) {
        emit('close');
    }
}

function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') {
        emit('close');
    }
}

onMounted(() => {
    document.addEventListener('mousedown', onDocClick);
    window.addEventListener('keydown', onKey);
});

onBeforeUnmount(() => {
    document.removeEventListener('mousedown', onDocClick);
    window.removeEventListener('keydown', onKey);
});
</script>

<template>
    <div
        ref="root"
        class="absolute right-0 bottom-full z-30 mb-2 max-h-72 w-80 overflow-y-auto rounded-xl border border-ss-border bg-ss-surface p-2 shadow-xl"
    >
        <div v-for="cat in CATEGORIES" :key="cat.name" class="mb-2 last:mb-0">
            <p
                class="px-1 pb-1 text-[10px] font-semibold tracking-wide text-ss-text-3 uppercase"
            >
                {{ cat.name }}
            </p>
            <div class="grid grid-cols-10 gap-0.5">
                <button
                    v-for="e in cat.emoji"
                    :key="e"
                    type="button"
                    class="grid h-7 w-7 place-items-center rounded text-[16px] hover:bg-ss-surface-2"
                    :title="e"
                    @click="emit('select', e)"
                >
                    {{ e }}
                </button>
            </div>
        </div>
    </div>
</template>
