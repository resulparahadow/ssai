<script setup lang="ts">
import { Check, Film, Image as ImageIcon, Lock } from '@lucide/vue';
import { computed, ref } from 'vue';
import { relativeTime } from '@/lib/datetime';
import { usd } from '@/lib/money';
import { mediaSrc } from '@/lib/onlyfans';
import { sentPpvs } from '@/lib/sentPpvs';
import type { SentPpv } from '@/lib/sentPpvs';
import type { OfMessage } from '@/types/crm';

/**
 * Right-rail "PPV" tab (CreatorHero's): every priced message the creator sent this fan in the
 * loaded thread, newest first, with Bought / Not bought. Built from the thread, so PPVs sent
 * from CreatorHero or OnlyFans show too. Click → the thread scrolls to that message.
 */
const props = defineProps<{ modelId: number; messages: OfMessage[] }>();
const emit = defineEmits<{ jump: [id: string] }>();

const ppvs = computed(() => sentPpvs(props.messages));

const broken = ref(new Set<string>());

function thumbUrl(p: SentPpv): string | null {
    const t = p.thumb;

    if (!t || !t.canView || broken.value.has(p.id)) {
        return null;
    }

    const url = t.thumb ?? t.preview;

    return url ? mediaSrc(props.modelId, url) : null;
}

function markBroken(id: string) {
    broken.value = new Set(broken.value).add(id);
}
</script>

<template>
    <div class="min-h-0 flex-1 overflow-y-auto" data-testid="sent-ppvs">
        <p
            v-if="!ppvs.length"
            class="px-4 py-10 text-center text-[12px] text-ss-text-3"
        >
            No PPVs sent to this fan yet.
        </p>
        <template v-else>
            <ul class="divide-y divide-ss-border">
                <li v-for="p in ppvs" :key="p.id">
                    <button
                        type="button"
                        class="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-ss-surface-2 focus-visible:bg-ss-surface-2 focus-visible:ring-2 focus-visible:ring-ss-accent focus-visible:outline-none focus-visible:ring-inset"
                        title="Show this message in the chat"
                        :data-testid="`sent-ppv-${p.id}`"
                        @click="emit('jump', p.id)"
                    >
                        <span
                            class="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-ss-surface-2 text-ss-text-3"
                        >
                            <img
                                v-if="thumbUrl(p)"
                                :src="thumbUrl(p)!"
                                alt=""
                                class="h-full w-full object-cover"
                                loading="lazy"
                                @error="markBroken(p.id)"
                            />
                            <Lock
                                v-else-if="p.thumb && !p.thumb.canView"
                                :size="16"
                            />
                            <Film
                                v-else-if="p.thumb?.type === 'video'"
                                :size="16"
                            />
                            <ImageIcon v-else :size="16" />
                        </span>
                        <span class="min-w-0 flex-1">
                            <span
                                class="flex min-w-0 items-center gap-1.5 text-[12px]"
                            >
                                <span
                                    class="font-semibold text-ss-text tabular-nums"
                                    >{{ usd(p.price) }}</span
                                >
                                <span
                                    class="inline-flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-px text-[10px] font-semibold"
                                    :class="
                                        p.opened
                                            ? 'bg-ss-pos/15 text-ss-pos'
                                            : 'border border-ss-border text-ss-text-2'
                                    "
                                    data-testid="ppv-bought"
                                    ><Check v-if="p.opened" :size="10" />{{
                                        p.opened ? 'Bought' : 'Not bought'
                                    }}</span
                                >
                                <span
                                    v-if="p.mass"
                                    class="shrink-0 text-[10px] text-ss-text-3"
                                    title="Sent as an OnlyFans mass message"
                                    >· Mass</span
                                >
                            </span>
                            <span
                                class="mt-0.5 flex items-center gap-2 text-[11px] text-ss-text-3"
                            >
                                <span v-if="p.createdAt">{{
                                    relativeTime(p.createdAt)
                                }}</span>
                                <span
                                    v-if="p.photos"
                                    class="inline-flex items-center gap-0.5"
                                    ><ImageIcon :size="11" />{{
                                        p.photos
                                    }}</span
                                >
                                <span
                                    v-if="p.videos"
                                    class="inline-flex items-center gap-0.5"
                                    ><Film :size="11" />{{ p.videos }}</span
                                >
                            </span>
                            <span
                                v-if="p.text"
                                class="mt-1 line-clamp-2 text-[12px] leading-snug text-ss-text-2"
                                >{{ p.text }}</span
                            >
                        </span>
                    </button>
                </li>
            </ul>
            <p class="px-3 py-2.5 text-[11px] text-ss-text-3">
                From the messages loaded in this chat.
            </p>
        </template>
    </div>
</template>
