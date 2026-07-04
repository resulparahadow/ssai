<script setup lang="ts">
import { Form, Head, Link, usePage } from '@inertiajs/vue3';
import { computed } from 'vue';
import ProfileController from '@/actions/App/Http/Controllers/Settings/ProfileController';
import DeleteUser from '@/components/DeleteUser.vue';
import InputError from '@/components/InputError.vue';
import { send } from '@/routes/verification';

const page = usePage();
const user = computed(() => page.props.auth.user);
</script>

<template>
    <Head title="Profile settings" />

    <h1 class="sr-only">Profile settings</h1>

    <div class="space-y-6">
        <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
            <div class="mb-4">
                <h3 class="text-sm font-semibold text-ss-text">Profile</h3>
                <p class="text-sm text-ss-text-2">
                    Update your name and email address
                </p>
            </div>

            <Form
                v-bind="ProfileController.update.form()"
                class="space-y-5"
                v-slot="{ errors, processing }"
            >
                <div class="grid gap-1.5">
                    <label for="name" class="text-sm font-medium text-ss-text-2"
                        >Name</label
                    >
                    <input
                        id="name"
                        name="name"
                        :value="user.name"
                        required
                        autocomplete="name"
                        placeholder="Full name"
                        class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                    />
                    <InputError :message="errors.name" />
                </div>

                <div class="grid gap-1.5">
                    <label
                        for="email"
                        class="text-sm font-medium text-ss-text-2"
                        >Email address</label
                    >
                    <input
                        id="email"
                        type="email"
                        name="email"
                        :value="user.email"
                        required
                        autocomplete="username"
                        placeholder="Email address"
                        class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                    />
                    <InputError :message="errors.email" />
                </div>

                <div
                    v-if="page.props.mustVerifyEmail && !user.email_verified_at"
                >
                    <p class="text-sm text-ss-text-2">
                        Your email address is unverified.
                        <Link
                            :href="send()"
                            as="button"
                            class="text-ss-accent underline underline-offset-4"
                        >
                            Click here to re-send the verification email.
                        </Link>
                    </p>

                    <div
                        v-if="page.props.status === 'verification-link-sent'"
                        class="mt-2 text-sm font-medium text-ss-pos"
                    >
                        A new verification link has been sent to your email
                        address.
                    </div>
                </div>

                <button
                    type="submit"
                    :disabled="processing"
                    data-test="update-profile-button"
                    class="rounded-lg bg-ss-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                    Save
                </button>
            </Form>
        </div>

        <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
            <DeleteUser />
        </div>
    </div>
</template>
