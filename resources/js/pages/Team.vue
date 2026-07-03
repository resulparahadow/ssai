<script setup lang="ts">
import { Head, router, useForm, usePage } from '@inertiajs/vue3';
import { KeyRound, Pencil, Plus, Trash2, Users, X } from '@lucide/vue';
import { computed, ref } from 'vue';
import type { Role, User } from '@/types/auth';
import type { TeamUser } from '@/types/crm';

const props = defineProps<{
    users: TeamUser[];
    assignableCreators: string[];
    assignableRoles: Role[];
}>();

const me = computed(() => usePage().props.auth.user as User);

const ROLE_LABEL: Record<Role, string> = {
    admin: 'Admin',
    manager: 'Manager',
    chatter: 'Chatter',
};

function roleBadge(role: Role): string {
    return {
        admin: 'bg-ss-accent-soft text-ss-accent-text',
        manager: 'bg-ss-warn/10 text-ss-warn',
        chatter: 'bg-ss-surface-2 text-ss-text-2',
    }[role];
}

function initials(name: string): string {
    return (
        name
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((w) => w[0])
            .join('')
            .toUpperCase() || '?'
    );
}

// Client mirror of UserPolicy (the server is the real gate).
function canManage(u: TeamUser): boolean {
    if (me.value.role === 'admin') {
        return true;
    }

    return me.value.role === 'manager' && u.role === 'chatter';
}

// ---- create / edit modal ----
const modalOpen = ref(false);
const editing = ref<TeamUser | null>(null);

const form = useForm({
    name: '',
    email: '',
    role: 'chatter' as Role,
    password: '',
    password_confirmation: '',
    must_change_password: true,
    assigned: [] as string[],
});

// Only send password when the admin actually typed one (blank = keep current on edit).
form.transform((data) => {
    const out = { ...data };

    if (!out.password) {
        delete (out as Record<string, unknown>).password;
        delete (out as Record<string, unknown>).password_confirmation;
    }

    return out;
});

function openCreate() {
    editing.value = null;
    form.reset();
    form.clearErrors();
    form.role = props.assignableRoles[0] ?? 'chatter';
    form.must_change_password = true;
    modalOpen.value = true;
}

function openEdit(u: TeamUser) {
    editing.value = u;
    form.reset();
    form.clearErrors();
    form.name = u.name;
    form.email = u.email;
    form.role = u.role;
    form.must_change_password = u.must_change_password;
    form.assigned = [...u.assigned];
    modalOpen.value = true;
}

function toggleCreator(name: string) {
    const i = form.assigned.indexOf(name);

    if (i >= 0) {
        form.assigned.splice(i, 1);
    } else {
        form.assigned.push(name);
    }
}

function submit() {
    const opts = {
        preserveScroll: true,
        onSuccess: () => {
            modalOpen.value = false;
        },
    };

    if (editing.value) {
        form.put(`/team/${editing.value.id}`, opts);
    } else {
        form.post('/team', opts);
    }
}

function destroy(u: TeamUser) {
    if (
        !confirm(
            `Remove ${u.name}? This also clears their creator assignments.`,
        )
    ) {
        return;
    }

    router.delete(`/team/${u.id}`, { preserveScroll: true });
}
</script>

<template>
    <Head title="Team & roles" />

    <div class="mx-auto max-w-5xl space-y-5">
        <div class="flex flex-wrap items-end justify-between gap-3">
            <div>
                <h2 class="text-xl font-bold text-ss-text">Team &amp; roles</h2>
                <p class="text-sm text-ss-text-2">
                    Manage users, their roles, and creator assignments.
                </p>
            </div>
            <button
                type="button"
                class="flex items-center gap-1.5 rounded-lg bg-ss-accent px-3 py-2 text-sm font-semibold text-white disabled:opacity-50"
                @click="openCreate"
            >
                <Plus :size="15" /> Add user
            </button>
        </div>

        <div
            class="overflow-hidden rounded-xl border border-ss-border bg-ss-surface"
        >
            <div class="overflow-x-auto">
                <table class="w-full border-collapse text-[13px]">
                    <thead
                        class="bg-ss-surface-2 text-left text-[11px] text-ss-text-3"
                    >
                        <tr>
                            <th class="px-4 py-2.5 font-medium">User</th>
                            <th class="px-4 py-2.5 font-medium">Role</th>
                            <th class="px-4 py-2.5 font-medium">Creators</th>
                            <th class="px-4 py-2.5 font-medium">Status</th>
                            <th class="px-4 py-2.5 text-right font-medium">
                                Actions
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="u in users"
                            :key="u.id"
                            class="border-t border-ss-border"
                        >
                            <td class="px-4 py-2.5">
                                <div class="flex items-center gap-2.5">
                                    <span
                                        class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ss-surface-2 text-[11px] font-bold text-ss-text-2"
                                    >
                                        {{ initials(u.name) }}
                                    </span>
                                    <div class="min-w-0">
                                        <div
                                            class="truncate font-medium text-ss-text"
                                        >
                                            {{ u.name }}
                                            <span
                                                v-if="u.is_self"
                                                class="text-[11px] font-normal text-ss-text-3"
                                                >· you</span
                                            >
                                        </div>
                                        <div
                                            class="truncate text-[12px] text-ss-text-3"
                                        >
                                            {{ u.email }}
                                        </div>
                                    </div>
                                </div>
                            </td>
                            <td class="px-4 py-2.5">
                                <span
                                    class="inline-block rounded-full px-2 py-0.5 text-[11px] font-medium"
                                    :class="roleBadge(u.role)"
                                >
                                    {{ ROLE_LABEL[u.role] }}
                                </span>
                            </td>
                            <td class="px-4 py-2.5 text-ss-text-2">
                                <span
                                    v-if="u.role === 'chatter'"
                                    class="flex items-center gap-1.5"
                                >
                                    <Users :size="13" class="text-ss-text-3" />
                                    {{ u.assigned.length }}
                                </span>
                                <span v-else class="text-ss-text-3">All</span>
                            </td>
                            <td class="px-4 py-2.5">
                                <span
                                    v-if="u.must_change_password"
                                    class="inline-flex items-center gap-1 rounded-full bg-ss-warn/10 px-2 py-0.5 text-[11px] font-medium text-ss-warn"
                                >
                                    <KeyRound :size="11" /> Pending password
                                </span>
                                <span v-else class="text-[12px] text-ss-text-3"
                                    >Active</span
                                >
                            </td>
                            <td class="px-4 py-2.5">
                                <div
                                    class="flex items-center justify-end gap-1"
                                >
                                    <button
                                        v-if="canManage(u)"
                                        type="button"
                                        class="grid h-8 w-8 place-items-center rounded-lg text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-text"
                                        title="Edit user"
                                        @click="openEdit(u)"
                                    >
                                        <Pencil :size="15" />
                                    </button>
                                    <button
                                        v-if="canManage(u) && !u.is_self"
                                        type="button"
                                        class="grid h-8 w-8 place-items-center rounded-lg text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-neg"
                                        title="Remove user"
                                        @click="destroy(u)"
                                    >
                                        <Trash2 :size="15" />
                                    </button>
                                    <span
                                        v-if="!canManage(u)"
                                        class="text-[11px] text-ss-text-3"
                                        >—</span
                                    >
                                </div>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>

    <!-- Create / edit modal -->
    <Transition
        enter-active-class="transition-opacity duration-200 ease-out"
        enter-from-class="opacity-0"
        enter-to-class="opacity-100"
        leave-active-class="transition-opacity duration-150 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
    >
        <div
            v-if="modalOpen"
            class="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
            @click.self="modalOpen = false"
        >
            <Transition
                appear
                enter-active-class="transition duration-200 ease-out"
                enter-from-class="opacity-0 translate-y-2 scale-95"
                enter-to-class="opacity-100 translate-y-0 scale-100"
                leave-active-class="transition duration-150 ease-in"
                leave-from-class="opacity-100 translate-y-0 scale-100"
                leave-to-class="opacity-0 translate-y-2 scale-95"
            >
                <div
                    v-if="modalOpen"
                    class="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-ss-border bg-ss-surface p-5 shadow-xl"
                >
                    <div class="mb-4 flex items-center justify-between">
                        <h3 class="text-base font-semibold text-ss-text">
                            {{ editing ? 'Edit user' : 'Add user' }}
                        </h3>
                        <button
                            type="button"
                            class="grid h-8 w-8 place-items-center rounded-lg text-ss-text-3 hover:bg-ss-surface-2 hover:text-ss-text"
                            @click="modalOpen = false"
                        >
                            <X :size="16" />
                        </button>
                    </div>

                    <form class="space-y-4" @submit.prevent="submit">
                        <div class="grid gap-3 sm:grid-cols-2">
                            <label class="block">
                                <span
                                    class="mb-1 block text-[12px] text-ss-text-2"
                                    >Name</span
                                >
                                <input
                                    v-model="form.name"
                                    type="text"
                                    class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                                />
                                <p
                                    v-if="form.errors.name"
                                    class="mt-1 text-[12px] text-ss-neg"
                                >
                                    {{ form.errors.name }}
                                </p>
                            </label>
                            <label class="block">
                                <span
                                    class="mb-1 block text-[12px] text-ss-text-2"
                                    >Role</span
                                >
                                <select
                                    v-model="form.role"
                                    :disabled="editing?.is_self"
                                    class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none disabled:opacity-60"
                                >
                                    <option
                                        v-for="r in assignableRoles"
                                        :key="r"
                                        :value="r"
                                    >
                                        {{ ROLE_LABEL[r] }}
                                    </option>
                                </select>
                                <p
                                    v-if="form.errors.role"
                                    class="mt-1 text-[12px] text-ss-neg"
                                >
                                    {{ form.errors.role }}
                                </p>
                            </label>
                        </div>

                        <label class="block">
                            <span class="mb-1 block text-[12px] text-ss-text-2"
                                >Email</span
                            >
                            <input
                                v-model="form.email"
                                type="email"
                                class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                            />
                            <p
                                v-if="form.errors.email"
                                class="mt-1 text-[12px] text-ss-neg"
                            >
                                {{ form.errors.email }}
                            </p>
                        </label>

                        <div class="grid gap-3 sm:grid-cols-2">
                            <label class="block">
                                <span
                                    class="mb-1 block text-[12px] text-ss-text-2"
                                >
                                    {{ editing ? 'New password' : 'Password' }}
                                    <span v-if="editing" class="text-ss-text-3"
                                        >(leave blank to keep)</span
                                    >
                                </span>
                                <input
                                    v-model="form.password"
                                    type="password"
                                    autocomplete="new-password"
                                    class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                                />
                                <p
                                    v-if="form.errors.password"
                                    class="mt-1 text-[12px] text-ss-neg"
                                >
                                    {{ form.errors.password }}
                                </p>
                            </label>
                            <label class="block">
                                <span
                                    class="mb-1 block text-[12px] text-ss-text-2"
                                    >Confirm password</span
                                >
                                <input
                                    v-model="form.password_confirmation"
                                    type="password"
                                    autocomplete="new-password"
                                    class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                                />
                            </label>
                        </div>

                        <label
                            class="flex items-center gap-2 text-[13px] text-ss-text-2"
                        >
                            <input
                                v-model="form.must_change_password"
                                type="checkbox"
                                class="h-4 w-4 rounded border-ss-border accent-ss-accent"
                            />
                            Require password change on next login
                        </label>

                        <div v-if="form.role === 'chatter'">
                            <span class="mb-1 block text-[12px] text-ss-text-2"
                                >Creator assignments</span
                            >
                            <div
                                v-if="assignableCreators.length"
                                class="flex flex-wrap gap-1.5"
                            >
                                <button
                                    v-for="c in assignableCreators"
                                    :key="c"
                                    type="button"
                                    class="rounded-md border px-2.5 py-1 text-[12px] transition-colors"
                                    :class="
                                        form.assigned.includes(c)
                                            ? 'border-ss-accent bg-ss-accent-soft text-ss-accent-text'
                                            : 'border-ss-border text-ss-text-3 hover:text-ss-text'
                                    "
                                    @click="toggleCreator(c)"
                                >
                                    {{ c }}
                                </button>
                            </div>
                            <p v-else class="text-[12px] text-ss-text-3">
                                No creator models yet.
                            </p>
                        </div>

                        <div class="flex justify-end gap-2 pt-1">
                            <button
                                type="button"
                                class="rounded-lg border border-ss-border px-4 py-2 text-[13px] font-medium text-ss-text-2 hover:bg-ss-surface-2"
                                @click="modalOpen = false"
                            >
                                Cancel
                            </button>
                            <button
                                type="submit"
                                class="rounded-lg bg-ss-accent px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
                                :disabled="form.processing"
                            >
                                {{
                                    form.processing
                                        ? 'Saving…'
                                        : editing
                                          ? 'Save changes'
                                          : 'Create user'
                                }}
                            </button>
                        </div>
                    </form>
                </div>
            </Transition>
        </div>
    </Transition>
</template>
