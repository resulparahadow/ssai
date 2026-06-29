<script setup lang="ts">
import { LoaderCircle, Tag } from '@lucide/vue';
import { onMounted, ref } from 'vue';
import { ofModel } from '@/lib/onlyfansModel';

const props = defineProps<{ modelId: number }>();

type TypeKey = '' | 'trial_links' | 'tracking_links' | 'smart_links';
const FILTERS: { key: TypeKey; label: string }[] = [
    { key: '', label: 'All link types' },
    { key: 'trial_links', label: 'Free trial' },
    { key: 'tracking_links', label: 'Tracking' },
    { key: 'smart_links', label: 'Smart' },
];

const filter = ref<TypeKey>('');
const tags = ref<string[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

async function load() {
    loading.value = true;
    error.value = null;

    try {
        tags.value = (await ofModel.linkTags(props.modelId, filter.value || undefined)).tags;
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to load tags.';
    } finally {
        loading.value = false;
    }
}

function switchFilter(k: TypeKey) {
    if (filter.value === k) {
        return;
    }

    filter.value = k;
    load();
}

onMounted(load);
</script>

<template>
    <div class="space-y-3">
        <p class="text-[12px] text-ss-text-3">Every tag used across this account's free-trial, tracking and Smart links — handy when naming a new link.</p>

        <div class="flex flex-wrap items-center gap-1.5">
            <button
                v-for="f in FILTERS"
                :key="f.key"
                type="button"
                class="rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors"
                :class="filter === f.key ? 'bg-ss-surface-2 text-ss-text' : 'text-ss-text-3 hover:text-ss-text-2'"
                @click="switchFilter(f.key)"
            >
                {{ f.label }}
            </button>
        </div>

        <p v-if="error" class="rounded-lg border border-ss-border bg-ss-surface p-4 text-center text-[12px] text-ss-neg">{{ error }}</p>

        <div v-if="loading" class="flex justify-center py-6"><LoaderCircle :size="18" class="animate-spin text-ss-text-3" /></div>

        <div v-else-if="tags.length" class="flex flex-wrap gap-1.5 rounded-xl border border-ss-border bg-ss-surface p-4">
            <span v-for="t in tags" :key="t" class="flex items-center gap-1 rounded-full bg-ss-surface-2 px-2.5 py-1 text-[12px] text-ss-text-2">
                <Tag :size="11" class="text-ss-text-3" /> {{ t }}
            </span>
        </div>

        <p v-else class="rounded-xl border border-dashed border-ss-border p-8 text-center text-[13px] text-ss-text-3">No tags found for this link type.</p>
    </div>
</template>
