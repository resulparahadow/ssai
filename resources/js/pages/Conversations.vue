<script setup lang="ts">
import { Head, usePage } from '@inertiajs/vue3';
import { computed, ref, watch } from 'vue';
import SsChatThread from '@/components/crm/conversations/SsChatThread.vue';
import SsComposer from '@/components/crm/conversations/SsComposer.vue';
import SsConvoList from '@/components/crm/conversations/SsConvoList.vue';
import SsFanPanel from '@/components/crm/conversations/SsFanPanel.vue';
import { ofApi } from '@/lib/onlyfans';
import type { OfChat, OfFan, OfMessage, SidebarCreator } from '@/types/crm';

const props = defineProps<{ selectedCreator: string | null }>();
const page = usePage();

const creators = computed<SidebarCreator[]>(() => (page.props.creators as SidebarCreator[]) ?? []);
const model = computed<SidebarCreator | null>(() => {
    const list = creators.value;

    if (!list.length) {
return null;
}

    return list.find((c) => c.name === props.selectedCreator) ?? list[0];
});

const chats = ref<OfChat[]>([]);
const chatsLoading = ref(false);
const chatsError = ref<string | null>(null);
const selected = ref<OfChat | null>(null);

const messages = ref<OfMessage[]>([]);
const msgsLoading = ref(false);
const msgsError = ref<string | null>(null);
const fan = ref<OfFan | null>(null);

async function loadChats() {
    selected.value = null;
    messages.value = [];
    fan.value = null;

    if (!model.value || !model.value.hasOf) {
        chats.value = [];
        chatsError.value = model.value && !model.value.hasOf ? 'No OnlyFans account connected for this creator (set it on Creator Models).' : null;

        return;
    }

    chatsLoading.value = true;
    chatsError.value = null;

    try {
        const r = await ofApi.chats(model.value.id);
        chats.value = r.chats as OfChat[];
    } catch (e) {
        chatsError.value = e instanceof Error ? e.message : String(e);
        chats.value = [];
    } finally {
        chatsLoading.value = false;
    }
}

async function openChat(chat: OfChat) {
    if (!model.value) {
return;
}

    selected.value = chat;
    messages.value = [];
    fan.value = null;
    msgsError.value = null;
    msgsLoading.value = true;

    try {
        const r = await ofApi.messages(model.value.id, chat.id);
        messages.value = r.messages as OfMessage[];
    } catch (e) {
        msgsError.value = e instanceof Error ? e.message : String(e);
    } finally {
        msgsLoading.value = false;
    }

    try {
        const f = await ofApi.fan(model.value.id, chat.id);
        fan.value = f.fan as OfFan;
    } catch {
        fan.value = null;
    }
}

async function refreshMessages() {
    if (!model.value || !selected.value) {
return;
}

    const r = await ofApi.messages(model.value.id, selected.value.id);
    messages.value = r.messages as OfMessage[];
}

async function onLike(m: OfMessage) {
    if (!model.value || !selected.value || !m.id) {
return;
}

    try {
        if (m.isLiked) {
await ofApi.unlike(model.value.id, selected.value.id, m.id);
} else {
await ofApi.like(model.value.id, selected.value.id, m.id);
}

        m.isLiked = !m.isLiked;
    } catch (e) {
        alert(e instanceof Error ? e.message : String(e));
    }
}

async function onDelete(m: OfMessage) {
    if (!model.value || !selected.value || !m.id) {
return;
}

    if (!confirm('Delete this message on OnlyFans?')) {
return;
}

    try {
        await ofApi.deleteMessage(model.value.id, selected.value.id, m.id);
        messages.value = messages.value.filter((x) => x.id !== m.id);
    } catch (e) {
        alert(e instanceof Error ? e.message : String(e));
    }
}

watch(model, () => loadChats(), { immediate: true });
</script>

<template>
    <Head title="Conversations" />

    <div class="flex h-full gap-4">
        <SsConvoList
            :chats="chats"
            :loading="chatsLoading"
            :error="chatsError"
            :creator="model?.name ?? null"
            :selected-id="selected?.id ?? null"
            @select="openChat"
            @refresh="loadChats"
        />

        <template v-if="selected && model">
            <SsChatThread
                :model-id="model.id"
                :chat="selected"
                :messages="messages"
                :loading="msgsLoading"
                :error="msgsError"
                @like="onLike"
                @delete="onDelete"
            >
                <template #composer>
                    <SsComposer
                        :model-id="model.id"
                        :chat-id="selected.id"
                        :creator="model.name"
                        :messages="messages"
                        @sent="refreshMessages"
                    />
                </template>
            </SsChatThread>
            <SsFanPanel :fan="fan" />
        </template>

        <div v-else class="grid flex-1 place-items-center rounded-xl border border-ss-border bg-ss-surface text-[13px] text-ss-text-3">
            <span v-if="!model">Pick a creator from the sidebar.</span>
            <span v-else-if="chatsError">{{ chatsError }}</span>
            <span v-else-if="chatsLoading">Loading chats…</span>
            <span v-else>Select a conversation.</span>
        </div>
    </div>
</template>
