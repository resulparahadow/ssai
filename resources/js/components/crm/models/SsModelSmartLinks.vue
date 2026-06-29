<script setup lang="ts">
import { BarChart3, ChevronDown, Copy, Heart, LoaderCircle, MousePointerClick, Plus, Tag, Trash2, TrendingUp, Users } from '@lucide/vue';
import { onMounted, reactive, ref } from 'vue';
import { ofModel } from '@/lib/onlyfansModel';
import type {
    OfLinkStats,
    OfSmartLink,
    OfSmartLinkClick,
    OfSmartLinkConversion,
    OfSmartLinkConversionsSummary,
    OfSmartLinkFan,
    OfSmartLinkFansSummary,
    OfSmartLinkSpender,
} from '@/types/crm';

const props = defineProps<{ modelId: number }>();

const links = ref<OfSmartLink[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);

// ---- create form ----
const showCreate = ref(false);
const creating = ref(false);
const cName = ref('');
const cType = ref<'free_trial' | 'tracking_link'>('tracking_link');
const cDays = ref(30);
const DURATIONS = [1, 3, 7, 14, 30, 90, 180, 360];

// ---- per-link detail (one open at a time) ----
type DetailTab = 'stats' | 'fans' | 'spenders' | 'clicks' | 'conversions' | 'tags';
const DETAIL_TABS: { key: DetailTab; label: string; icon: typeof Users }[] = [
    { key: 'stats', label: 'Stats', icon: BarChart3 },
    { key: 'conversions', label: 'Conversions', icon: TrendingUp },
    { key: 'fans', label: 'Fans', icon: Heart },
    { key: 'spenders', label: 'Spenders', icon: Users },
    { key: 'clicks', label: 'Clicks', icon: MousePointerClick },
    { key: 'tags', label: 'Tags', icon: Tag },
];

interface Detail {
    tab: DetailTab;
    loading: boolean;
    err: string | null;
    stats: OfLinkStats | null;
    fans: { summary: OfSmartLinkFansSummary; rows: OfSmartLinkFan[] } | null;
    spenders: OfSmartLinkSpender[] | null;
    clicks: { total: number; rows: OfSmartLinkClick[] } | null;
    conversions: { summary: OfSmartLinkConversionsSummary; rows: OfSmartLinkConversion[] } | null;
    tags: string[] | null;
    newTag: string;
    tagBusy: boolean;
}

const expanded = ref<string | null>(null);
const detail = reactive<Record<string, Detail>>({});

function blankDetail(): Detail {
    return { tab: 'stats', loading: false, err: null, stats: null, fans: null, spenders: null, clicks: null, conversions: null, tags: null, newTag: '', tagBusy: false };
}

async function load() {
    loading.value = true;
    error.value = null;

    try {
        links.value = (await ofModel.smartLinks(props.modelId, { limit: 50 })).links;
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to load smart links.';
    } finally {
        loading.value = false;
    }
}

async function create() {
    creating.value = true;
    error.value = null;

    try {
        await ofModel.createSmartLink(props.modelId, {
            name: cName.value.trim(),
            link_type: cType.value,
            free_trial_days: cType.value === 'free_trial' ? cDays.value : undefined,
        });
        cName.value = '';
        showCreate.value = false;
        await load();
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to create smart link.';
    } finally {
        creating.value = false;
    }
}

async function remove(id: string | null) {
    if (!id || !confirm('Delete this smart link? This cannot be undone.')) {
        return;
    }

    try {
        await ofModel.deleteSmartLink(props.modelId, id);

        if (expanded.value === id) {
            expanded.value = null;
        }

        await load();
    } catch (e) {
        error.value = e instanceof Error ? e.message : 'Failed to delete smart link.';
    }
}

function toggle(id: string | null) {
    if (!id) {
        return;
    }

    if (expanded.value === id) {
        expanded.value = null;

        return;
    }

    expanded.value = id;

    if (!detail[id]) {
        detail[id] = blankDetail();
    }

    openDetailTab(id, detail[id].tab);
}

async function openDetailTab(id: string, tab: DetailTab) {
    const d = detail[id];
    d.tab = tab;

    // each section loads once, then stays cached
    if (
        (tab === 'stats' && d.stats) ||
        (tab === 'fans' && d.fans) ||
        (tab === 'spenders' && d.spenders) ||
        (tab === 'clicks' && d.clicks) ||
        (tab === 'conversions' && d.conversions) ||
        (tab === 'tags' && d.tags)
    ) {
        return;
    }

    d.loading = true;
    d.err = null;

    try {
        if (tab === 'stats') {
            d.stats = (await ofModel.smartLinkStats(props.modelId, id)).stats;
        } else if (tab === 'fans') {
            d.fans = await ofModel.smartLinkFans(props.modelId, id, { limit: 20 });
        } else if (tab === 'spenders') {
            d.spenders = (await ofModel.smartLinkSpenders(props.modelId, id, { limit: 20 })).rows;
        } else if (tab === 'clicks') {
            d.clicks = await ofModel.smartLinkClicks(props.modelId, id, { limit: 20 });
        } else if (tab === 'conversions') {
            d.conversions = await ofModel.smartLinkConversions(props.modelId, id, { limit: 20 });
        } else if (tab === 'tags') {
            d.tags = (await ofModel.smartLinkTags(props.modelId, id)).tags;
        }
    } catch (e) {
        d.err = e instanceof Error ? e.message : 'Failed to load.';
    } finally {
        d.loading = false;
    }
}

async function addTag(id: string) {
    const d = detail[id];
    const t = d.newTag.trim();

    if (!t || d.tagBusy) {
        return;
    }

    d.tagBusy = true;

    try {
        d.tags = (await ofModel.addSmartLinkTags(props.modelId, id, [t])).tags;
        d.newTag = '';
    } catch (e) {
        d.err = e instanceof Error ? e.message : 'Failed to add tag.';
    } finally {
        d.tagBusy = false;
    }
}

async function removeTag(id: string, tag: string) {
    const d = detail[id];
    d.tagBusy = true;

    try {
        d.tags = (await ofModel.removeSmartLinkTags(props.modelId, id, [tag])).tags;
    } catch (e) {
        d.err = e instanceof Error ? e.message : 'Failed to remove tag.';
    } finally {
        d.tagBusy = false;
    }
}

function copy(url: string | null) {
    if (url) {
        navigator.clipboard?.writeText(url);
    }
}

function money(n: number): string {
    return `$${n % 1 === 0 ? n.toFixed(0) : n.toFixed(2)}`;
}

function typeLabel(t: string | null): string {
    return t === 'free_trial' ? 'Free trial' : t === 'tracking_link' ? 'Tracking' : (t ?? '');
}

function fmtDate(t: string | null): string {
    if (!t) {
        return '';
    }

    const d = new Date(t);

    return isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

onMounted(load);
</script>

<template>
    <div class="space-y-3">
        <div class="flex items-center justify-between gap-2">
            <p class="text-[12px] text-ss-text-3">Smart links auto-route fans and attribute revenue, clicks and conversions per campaign.</p>
            <button type="button" class="flex shrink-0 items-center gap-1 rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-semibold text-white" @click="showCreate = !showCreate">
                <Plus :size="14" /> New smart link
            </button>
        </div>

        <!-- create form -->
        <div v-if="showCreate" class="space-y-3 rounded-xl border border-ss-border bg-ss-surface p-4">
            <div class="grid gap-3 sm:grid-cols-2">
                <label class="block">
                    <span class="mb-1 block text-[12px] text-ss-text-2">Name</span>
                    <input v-model="cName" type="text" maxlength="120" placeholder="TikTok campaign" class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none" />
                </label>
                <label class="block">
                    <span class="mb-1 block text-[12px] text-ss-text-2">Type</span>
                    <select v-model="cType" class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none">
                        <option value="tracking_link">Tracking link</option>
                        <option value="free_trial">Free trial</option>
                    </select>
                </label>
            </div>
            <label v-if="cType === 'free_trial'" class="block sm:max-w-[12rem]">
                <span class="mb-1 block text-[12px] text-ss-text-2">Free trial days</span>
                <select v-model.number="cDays" class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none">
                    <option v-for="d in DURATIONS" :key="d" :value="d">{{ d }} days</option>
                </select>
            </label>
            <div class="flex items-center gap-2">
                <button type="button" class="rounded-lg bg-ss-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50" :disabled="creating || !cName.trim()" @click="create">
                    {{ creating ? 'Creating…' : 'Create smart link' }}
                </button>
                <button type="button" class="rounded-lg border border-ss-border px-4 py-2 text-[13px] font-medium text-ss-text-2 hover:bg-ss-surface-2" @click="showCreate = false">Cancel</button>
            </div>
        </div>

        <p v-if="error" class="rounded-lg border border-ss-border bg-ss-surface p-4 text-center text-[12px] text-ss-neg">{{ error }}</p>

        <div v-if="links.length" class="overflow-hidden rounded-xl border border-ss-border bg-ss-surface">
            <div v-for="l in links" :key="l.id ?? ''" class="border-b border-ss-border last:border-b-0">
                <div class="flex items-center gap-3 p-3">
                    <button type="button" class="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-ss-text-3 transition-transform hover:bg-ss-surface-2 hover:text-ss-text" :class="{ 'rotate-180': expanded === l.id }" @click="toggle(l.id)">
                        <ChevronDown :size="16" />
                    </button>
                    <div class="min-w-0 flex-1">
                        <div class="flex items-center gap-1.5 text-[13px] font-medium text-ss-text">
                            <span class="truncate">{{ l.name || 'Untitled' }}</span>
                            <span class="rounded bg-ss-surface-2 px-1.5 py-0.5 text-[10px] text-ss-text-3">{{ typeLabel(l.linkType) }}</span>
                            <span v-if="l.freeTrialDays" class="rounded bg-ss-surface-2 px-1.5 py-0.5 text-[10px] text-ss-text-3">{{ l.freeTrialDays }}d free</span>
                        </div>
                        <button type="button" class="flex items-center gap-1 truncate text-[11px] text-ss-text-3 hover:text-ss-accent-text" @click="copy(l.url)">
                            <Copy :size="11" /> {{ l.url }}
                        </button>
                    </div>
                    <div class="hidden shrink-0 text-right text-[11px] text-ss-text-3 sm:block">
                        <div class="text-[13px] font-semibold text-ss-pos">{{ money(l.revenue) }}</div>
                        {{ l.clicks }} clicks · {{ l.conversions }} conv · {{ l.subscribers }} subs
                    </div>
                    <button type="button" class="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-neg" title="Delete" @click="remove(l.id)"><Trash2 :size="15" /></button>
                </div>

                <!-- detail -->
                <div v-if="expanded === l.id && l.id" class="border-t border-ss-border bg-ss-bg/40 p-3">
                    <div class="mb-3 flex flex-wrap gap-1">
                        <button
                            v-for="dt in DETAIL_TABS"
                            :key="dt.key"
                            type="button"
                            class="flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-[12px] font-semibold transition-colors"
                            :class="detail[l.id].tab === dt.key ? 'bg-ss-surface-2 text-ss-text' : 'text-ss-text-3 hover:text-ss-text-2'"
                            @click="openDetailTab(l.id, dt.key)"
                        >
                            <component :is="dt.icon" :size="13" /> {{ dt.label }}
                        </button>
                    </div>

                    <div v-if="detail[l.id].loading" class="flex justify-center py-6"><LoaderCircle :size="18" class="animate-spin text-ss-text-3" /></div>
                    <p v-else-if="detail[l.id].err" class="rounded-lg border border-ss-border bg-ss-surface p-3 text-center text-[12px] text-ss-neg">{{ detail[l.id].err }}</p>

                    <template v-else>
                        <!-- Stats -->
                        <div v-if="detail[l.id].tab === 'stats' && detail[l.id].stats" class="grid grid-cols-2 gap-2 text-center sm:grid-cols-4">
                            <div v-for="(val, lbl) in { Clicks: detail[l.id].stats!.clicks, Subs: detail[l.id].stats!.subs, Spenders: detail[l.id].stats!.spenders, Revenue: money(detail[l.id].stats!.revenue) }" :key="lbl" class="rounded-lg bg-ss-surface p-2.5">
                                <div class="text-[14px] font-semibold text-ss-text">{{ val }}</div>
                                <div class="text-[10px] text-ss-text-3">{{ lbl }}</div>
                            </div>
                        </div>

                        <!-- Conversions -->
                        <div v-else-if="detail[l.id].tab === 'conversions' && detail[l.id].conversions" class="space-y-2">
                            <div class="grid grid-cols-3 gap-2 text-center">
                                <div v-for="(val, lbl) in { Conversions: detail[l.id].conversions!.summary.conversionsTotal, Subscribers: detail[l.id].conversions!.summary.subscribersTotal, Revenue: money(detail[l.id].conversions!.summary.revenueTotal) }" :key="lbl" class="rounded-lg bg-ss-surface p-2.5">
                                    <div class="text-[14px] font-semibold text-ss-text">{{ val }}</div>
                                    <div class="text-[10px] text-ss-text-3">{{ lbl }}</div>
                                </div>
                            </div>
                            <div v-if="detail[l.id].conversions!.rows.length" class="divide-y divide-ss-border overflow-hidden rounded-lg bg-ss-surface">
                                <div v-for="c in detail[l.id].conversions!.rows" :key="c.id ?? ''" class="flex items-center gap-2 p-2.5 text-[12px]">
                                    <span class="min-w-0 flex-1 truncate text-ss-text">{{ c.fan.name || c.fan.username || 'Fan' }}</span>
                                    <span class="rounded bg-ss-surface-2 px-1.5 py-0.5 text-[10px] text-ss-text-3">{{ c.conversionType }}</span>
                                    <span class="text-ss-pos">{{ money(c.amountNet) }}</span>
                                    <span class="text-ss-text-3">{{ fmtDate(c.conversionAt) }}</span>
                                </div>
                            </div>
                            <p v-else class="py-3 text-center text-[12px] text-ss-text-3">No conversions yet.</p>
                        </div>

                        <!-- Fans -->
                        <div v-else-if="detail[l.id].tab === 'fans' && detail[l.id].fans" class="space-y-2">
                            <div class="grid grid-cols-3 gap-2 text-center">
                                <div v-for="(val, lbl) in { Fans: detail[l.id].fans!.summary.fansTotal, 'Net revenue': money(detail[l.id].fans!.summary.revenueNetTotal), 'Net tips': money(detail[l.id].fans!.summary.tipsNetTotal) }" :key="lbl" class="rounded-lg bg-ss-surface p-2.5">
                                    <div class="text-[14px] font-semibold text-ss-text">{{ val }}</div>
                                    <div class="text-[10px] text-ss-text-3">{{ lbl }}</div>
                                </div>
                            </div>
                            <div v-if="detail[l.id].fans!.rows.length" class="divide-y divide-ss-border overflow-hidden rounded-lg bg-ss-surface">
                                <div v-for="f in detail[l.id].fans!.rows" :key="f.fanId ?? f.onlyfansId ?? ''" class="flex items-center gap-2 p-2.5 text-[12px]">
                                    <span class="min-w-0 flex-1 truncate text-ss-text">{{ f.name || f.username || 'Fan' }}</span>
                                    <span class="text-ss-text-3">{{ f.messagesSentByFan }} msgs</span>
                                    <span class="text-ss-pos">{{ money(f.revenueNet) }}</span>
                                </div>
                            </div>
                            <p v-else class="py-3 text-center text-[12px] text-ss-text-3">No fans attributed yet.</p>
                        </div>

                        <!-- Spenders -->
                        <div v-else-if="detail[l.id].tab === 'spenders'">
                            <div v-if="detail[l.id].spenders!.length" class="divide-y divide-ss-border overflow-hidden rounded-lg bg-ss-surface">
                                <div v-for="(s, i) in detail[l.id].spenders" :key="s.onlyfansId ?? i" class="flex items-center gap-2 p-2.5 text-[12px]">
                                    <span class="w-5 text-ss-text-3">{{ i + 1 }}</span>
                                    <span class="min-w-0 flex-1 truncate text-ss-text">{{ s.username || s.onlyfansId }}</span>
                                    <span class="font-semibold text-ss-pos">{{ money(s.revenue) }}</span>
                                </div>
                            </div>
                            <p v-else class="py-3 text-center text-[12px] text-ss-text-3">No spenders yet.</p>
                        </div>

                        <!-- Clicks -->
                        <div v-else-if="detail[l.id].tab === 'clicks' && detail[l.id].clicks" class="space-y-2">
                            <p class="text-[12px] text-ss-text-3"><span class="font-semibold text-ss-text">{{ detail[l.id].clicks!.total }}</span> total clicks</p>
                            <div v-if="detail[l.id].clicks!.rows.length" class="divide-y divide-ss-border overflow-hidden rounded-lg bg-ss-surface">
                                <div v-for="c in detail[l.id].clicks!.rows" :key="c.id ?? ''" class="flex items-center gap-2 p-2.5 text-[12px]">
                                    <span class="min-w-0 flex-1 truncate text-ss-text-2">{{ c.referrer || 'Direct' }}</span>
                                    <span v-if="c.countryCode" class="rounded bg-ss-surface-2 px-1.5 py-0.5 text-[10px] text-ss-text-3">{{ c.countryCode }}</span>
                                    <span v-if="c.isBot" class="rounded bg-ss-warn/15 px-1.5 py-0.5 text-[10px] text-ss-warn">bot</span>
                                    <span class="text-ss-text-3">{{ fmtDate(c.createdAt) }}</span>
                                </div>
                            </div>
                            <p v-else class="py-3 text-center text-[12px] text-ss-text-3">No clicks yet.</p>
                        </div>

                        <!-- Tags -->
                        <div v-else-if="detail[l.id].tab === 'tags'" class="space-y-2.5">
                            <div class="flex flex-wrap gap-1.5">
                                <span v-for="t in detail[l.id].tags" :key="t" class="flex items-center gap-1 rounded-full bg-ss-surface-2 px-2.5 py-1 text-[12px] text-ss-text-2">
                                    {{ t }}
                                    <button type="button" class="text-ss-text-3 hover:text-ss-neg disabled:opacity-50" :disabled="detail[l.id].tagBusy" @click="removeTag(l.id, t)">&times;</button>
                                </span>
                                <span v-if="!detail[l.id].tags?.length" class="text-[12px] text-ss-text-3">No tags yet.</span>
                            </div>
                            <div class="flex items-center gap-2">
                                <input
                                    v-model="detail[l.id].newTag"
                                    type="text"
                                    maxlength="60"
                                    placeholder="Add a tag"
                                    class="h-8 flex-1 rounded-lg border border-ss-border bg-ss-bg px-2 text-[12px] text-ss-text placeholder:text-ss-text-3 focus:border-ss-accent focus:outline-none sm:max-w-[16rem]"
                                    @keyup.enter="addTag(l.id)"
                                />
                                <button type="button" class="rounded-lg bg-ss-accent px-3 py-1.5 text-[12px] font-semibold text-white disabled:opacity-50" :disabled="detail[l.id].tagBusy || !detail[l.id].newTag.trim()" @click="addTag(l.id)">Add</button>
                            </div>
                        </div>
                    </template>
                </div>
            </div>
        </div>

        <p v-else-if="!loading" class="rounded-xl border border-ss-border bg-ss-surface p-6 text-center text-[13px] text-ss-text-3">No smart links yet.</p>

        <div v-if="loading" class="flex justify-center"><LoaderCircle :size="18" class="animate-spin text-ss-text-3" /></div>
    </div>
</template>
