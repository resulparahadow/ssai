<script setup lang="ts">
import { Check, LoaderCircle, ShieldCheck } from '@lucide/vue';
import { onMounted, reactive, ref } from 'vue';
import { ofModel } from '@/lib/onlyfansModel';
import type { OfSettings } from '@/types/crm';

const props = defineProps<{ modelId: number }>();

const loading = ref(true);
const error = ref<string | null>(null);
const settings = ref<OfSettings | null>(null);

// Editable profile (with a pristine copy so we only send changed fields).
type ProfileFields = Record<'name' | 'about' | 'location' | 'website' | 'wishlist', string>;
const form = reactive<ProfileFields>({ name: '', about: '', location: '', website: '', wishlist: '' });
let pristine: ProfileFields = { name: '', about: '', location: '', website: '', wishlist: '' };

const savingProfile = ref(false);
const profileSaved = ref(false);

const price = ref('');
const savingPrice = ref(false);
const priceSaved = ref(false);
const priceError = ref<string | null>(null);

async function load() {
    loading.value = true;
    error.value = null;

    try {
        const r = await ofModel.settings(props.modelId);
        settings.value = r.settings;
        const p = r.profile;
        const next: ProfileFields = {
            name: p.name ?? '',
            about: p.about ?? '',
            location: p.location ?? '',
            website: p.website ?? '',
            wishlist: p.wishlist ?? '',
        };
        Object.assign(form, next);
        pristine = { ...next };
        price.value = p.subscribePrice != null ? String(p.subscribePrice) : '';
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to load settings.';
    } finally {
        loading.value = false;
    }
}

async function saveProfile() {
    const changed: Partial<ProfileFields> = {};
    (Object.keys(form) as (keyof ProfileFields)[]).forEach((k) => {
        if (form[k] !== pristine[k]) {
            changed[k] = form[k];
        }
    });

    if (!Object.keys(changed).length) {
        return;
    }

    savingProfile.value = true;
    error.value = null;

    try {
        await ofModel.saveProfile(props.modelId, changed);
        pristine = { ...form };
        profileSaved.value = true;
        setTimeout(() => (profileSaved.value = false), 2000);
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to save profile.';
    } finally {
        savingProfile.value = false;
    }
}

async function savePrice() {
    const v = price.value.trim();
    priceError.value = null;

    if (v !== '0' && v.toLowerCase() !== 'free' && (isNaN(Number(v)) || Number(v) < 4.99 || Number(v) > 200)) {
        priceError.value = 'Use 0, "free", or 4.99–200.';

        return;
    }

    savingPrice.value = true;

    try {
        await ofModel.saveSubscriptionPrice(props.modelId, v);
        priceSaved.value = true;
        setTimeout(() => (priceSaved.value = false), 2000);
    } catch (e) {
        priceError.value = e instanceof Error ? e.message : 'Failed to save price.';
    } finally {
        savingPrice.value = false;
    }
}

onMounted(load);
</script>

<template>
    <div class="space-y-4">
        <p v-if="loading" class="flex items-center justify-center gap-2 py-8 text-[13px] text-ss-text-3">
            <LoaderCircle :size="16" class="animate-spin" /> Loading settings…
        </p>
        <p v-else-if="error && !settings" class="rounded-lg border border-ss-border bg-ss-surface p-4 text-center text-[12px] text-ss-neg">{{ error }}</p>

        <template v-else>
            <!-- Profile (editable) -->
            <div class="space-y-3 rounded-xl border border-ss-border bg-ss-surface p-4">
                <div class="flex items-center justify-between">
                    <h4 class="text-[13px] font-semibold text-ss-text">Profile</h4>
                    <span v-if="profileSaved" class="flex items-center gap-1 text-[11px] font-medium text-ss-pos"><Check :size="13" /> Saved</span>
                </div>
                <label class="block">
                    <span class="mb-1 block text-[12px] text-ss-text-2">Display name</span>
                    <input v-model="form.name" type="text" class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none" />
                </label>
                <label class="block">
                    <span class="mb-1 block text-[12px] text-ss-text-2">Bio</span>
                    <textarea v-model="form.about" rows="3" class="w-full resize-y rounded-lg border border-ss-border bg-ss-bg p-2.5 text-[13px] text-ss-text focus:border-ss-accent focus:outline-none" />
                </label>
                <div class="grid gap-3 sm:grid-cols-2">
                    <label class="block">
                        <span class="mb-1 block text-[12px] text-ss-text-2">Location</span>
                        <input v-model="form.location" type="text" class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none" />
                    </label>
                    <label class="block">
                        <span class="mb-1 block text-[12px] text-ss-text-2">Website</span>
                        <input v-model="form.website" type="text" class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none" />
                    </label>
                </div>
                <label class="block">
                    <span class="mb-1 block text-[12px] text-ss-text-2">Wishlist URL</span>
                    <input v-model="form.wishlist" type="text" class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none" />
                </label>
                <button
                    type="button"
                    class="rounded-lg bg-ss-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                    :disabled="savingProfile"
                    @click="saveProfile"
                >
                    {{ savingProfile ? 'Saving…' : 'Save profile' }}
                </button>
            </div>

            <!-- Subscription price (editable) -->
            <div class="space-y-2 rounded-xl border border-ss-border bg-ss-surface p-4">
                <div class="flex items-center justify-between">
                    <h4 class="text-[13px] font-semibold text-ss-text">Subscription price</h4>
                    <span v-if="priceSaved" class="flex items-center gap-1 text-[11px] font-medium text-ss-pos"><Check :size="13" /> Saved</span>
                </div>
                <div class="flex items-center gap-2">
                    <input
                        v-model="price"
                        type="text"
                        placeholder='0, "free", or 4.99–200'
                        class="h-9 w-44 rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                    />
                    <button
                        type="button"
                        class="rounded-lg border border-ss-border px-3 py-2 text-[13px] font-medium text-ss-text-2 hover:bg-ss-surface-2 disabled:opacity-50"
                        :disabled="savingPrice"
                        @click="savePrice"
                    >
                        Update
                    </button>
                </div>
                <p v-if="priceError" class="text-[11px] text-ss-neg">{{ priceError }}</p>
                <p class="text-[11px] text-ss-text-3">OnlyFans limits price changes to 3 per day.</p>
            </div>

            <!-- Account flags (read-only) -->
            <div class="rounded-xl border border-ss-border bg-ss-surface p-4">
                <h4 class="mb-3 flex items-center gap-1.5 text-[13px] font-semibold text-ss-text"><ShieldCheck :size="14" /> Account</h4>
                <dl class="grid grid-cols-2 gap-3 text-[12px]">
                    <div class="flex items-center justify-between rounded-lg bg-ss-surface-2 px-3 py-2">
                        <dt class="text-ss-text-2">Private profile</dt>
                        <dd class="font-medium" :class="settings?.isPrivate ? 'text-ss-pos' : 'text-ss-text-3'">{{ settings?.isPrivate ? 'On' : 'Off' }}</dd>
                    </div>
                    <div class="flex items-center justify-between rounded-lg bg-ss-surface-2 px-3 py-2">
                        <dt class="text-ss-text-2">DRM enabled</dt>
                        <dd class="font-medium" :class="settings?.isDrmEnabled ? 'text-ss-pos' : 'text-ss-text-3'">{{ settings?.isDrmEnabled ? 'On' : 'Off' }}</dd>
                    </div>
                    <div class="flex items-center justify-between rounded-lg bg-ss-surface-2 px-3 py-2">
                        <dt class="text-ss-text-2">Paid posts</dt>
                        <dd class="font-medium" :class="settings?.hasPaidPosts ? 'text-ss-pos' : 'text-ss-text-3'">{{ settings?.hasPaidPosts ? 'Yes' : 'No' }}</dd>
                    </div>
                    <div class="flex items-center justify-between rounded-lg bg-ss-surface-2 px-3 py-2">
                        <dt class="text-ss-text-2">Blocked countries</dt>
                        <dd class="font-medium text-ss-text">{{ settings?.blockedCountriesCount ?? 0 }}</dd>
                    </div>
                </dl>
            </div>
        </template>
    </div>
</template>
