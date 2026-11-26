<script setup lang="ts">
import { Head } from '@inertiajs/vue3';
import { BookOpen } from '@lucide/vue';

/**
 * The chatter guide, rendered server-side from docs/chatter-guide.md (GuideController), so the
 * file stays the one source. Opened in a new tab from the Conversations header. `html` is
 * Markdown output with raw HTML escaped server-side, so v-html only ever carries our own guide.
 */
defineProps<{
    html: string;
    toc: { id: string; text: string; level: number }[];
}>();

function jump(id: string): void {
    document
        .getElementById(id)
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    history.replaceState(history.state, '', `#${id}`);
}
</script>

<template>
    <Head title="Chatter guide" />

    <div class="mx-auto flex max-w-6xl flex-col gap-6 font-ss lg:flex-row">
        <!-- Contents: a list on top on small screens, a sticky column on wide ones. -->
        <nav
            aria-label="Guide contents"
            class="shrink-0 lg:sticky lg:top-0 lg:max-h-[calc(100vh-7rem)] lg:w-60 lg:overflow-y-auto"
        >
            <div class="rounded-xl border border-ss-border bg-ss-surface p-3">
                <div
                    class="mb-2 flex items-center gap-2 px-1 text-[12px] font-semibold text-ss-text"
                >
                    <BookOpen :size="14" class="text-ss-accent" />
                    Contents
                </div>
                <ul class="space-y-0.5">
                    <li v-for="h in toc" :key="h.id">
                        <a
                            :href="`#${h.id}`"
                            class="block truncate rounded-md px-2 py-1 text-[12px] hover:bg-ss-surface-2 hover:text-ss-text"
                            :class="
                                h.level === 2
                                    ? 'font-medium text-ss-text-2'
                                    : 'pl-5 text-ss-text-3'
                            "
                            :title="h.text"
                            @click.prevent="jump(h.id)"
                            >{{ h.text }}</a
                        >
                    </li>
                </ul>
            </div>
        </nav>

        <article
            class="guide min-w-0 flex-1 rounded-xl border border-ss-border bg-ss-surface px-5 py-6 sm:px-8"
            v-html="html"
        />
    </div>
</template>

<style scoped>
.guide {
    max-width: 52rem;
    color: var(--ss-text-2);
    font-size: 14px;
    line-height: 1.65;
}
.guide :deep(h1) {
    margin: 0 0 0.5rem;
    color: var(--ss-text);
    font-size: 1.5rem;
    font-weight: 700;
    line-height: 1.25;
}
.guide :deep(h2) {
    margin: 2.25rem 0 0.75rem;
    padding-top: 1.25rem;
    border-top: 1px solid var(--ss-border);
    color: var(--ss-text);
    font-size: 1.15rem;
    font-weight: 650;
    scroll-margin-top: 1rem;
}
.guide :deep(h3) {
    margin: 1.5rem 0 0.5rem;
    color: var(--ss-text);
    font-size: 0.98rem;
    font-weight: 600;
    scroll-margin-top: 1rem;
}
.guide :deep(p) {
    margin: 0.6rem 0;
}
.guide :deep(ul),
.guide :deep(ol) {
    margin: 0.6rem 0;
    padding-left: 1.3rem;
}
.guide :deep(ul) {
    list-style: disc;
}
.guide :deep(ol) {
    list-style: decimal;
}
.guide :deep(li) {
    margin: 0.25rem 0;
}
.guide :deep(li::marker) {
    color: var(--ss-text-3);
}
.guide :deep(strong) {
    color: var(--ss-text);
    font-weight: 600;
}
.guide :deep(em) {
    color: var(--ss-text-2);
}
.guide :deep(a) {
    color: var(--ss-accent-text);
    text-decoration: underline;
    text-underline-offset: 2px;
}
.guide :deep(code) {
    padding: 0.1rem 0.35rem;
    border-radius: 0.35rem;
    background: var(--ss-surface-2);
    color: var(--ss-text);
    font-size: 0.86em;
}
.guide :deep(pre) {
    overflow-x: auto;
    margin: 0.8rem 0;
    padding: 0.8rem 1rem;
    border-radius: 0.6rem;
    background: var(--ss-surface-2);
}
.guide :deep(pre code) {
    padding: 0;
    background: none;
}
.guide :deep(blockquote) {
    margin: 0.8rem 0;
    padding: 0.5rem 0.9rem;
    border: 1px solid var(--ss-border);
    border-radius: 0.5rem;
    background: var(--ss-accent-soft);
    color: var(--ss-text);
}
.guide :deep(hr) {
    display: none; /* h2 already draws the divider */
}
.guide :deep(table) {
    display: block;
    overflow-x: auto;
    width: 100%;
    margin: 0.9rem 0;
    border-collapse: collapse;
    font-size: 13px;
}
.guide :deep(th),
.guide :deep(td) {
    padding: 0.45rem 0.7rem;
    border: 1px solid var(--ss-border);
    text-align: left;
    vertical-align: top;
}
.guide :deep(th) {
    background: var(--ss-surface-2);
    color: var(--ss-text);
    font-weight: 600;
}
</style>
