<script setup lang="ts">
import { Form, Head } from '@inertiajs/vue3';
import SecurityController from '@/actions/App/Http/Controllers/Settings/SecurityController';
import InputError from '@/components/InputError.vue';
import type { Props as ManagePasskeysProps } from '@/components/ManagePasskeys.vue';
import ManagePasskeys from '@/components/ManagePasskeys.vue';
import type { Props as ManageTwoFactorProps } from '@/components/ManageTwoFactor.vue';
import ManageTwoFactor from '@/components/ManageTwoFactor.vue';
import PasswordInput from '@/components/PasswordInput.vue';

type Props = {
    passwordRules: string;
} & ManagePasskeysProps &
    ManageTwoFactorProps;

const props = defineProps<Props>();
</script>

<template>
    <Head title="Security settings" />

    <h1 class="sr-only">Security settings</h1>

    <div class="space-y-6">
        <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
            <div class="mb-4">
                <h3 class="text-sm font-semibold text-ss-text">
                    Update password
                </h3>
                <p class="text-sm text-ss-text-2">
                    Ensure your account is using a long, random password to stay
                    secure
                </p>
            </div>

            <Form
                v-bind="SecurityController.update.form()"
                :options="{ preserveScroll: true }"
                reset-on-success
                :reset-on-error="[
                    'password',
                    'password_confirmation',
                    'current_password',
                ]"
                class="space-y-5"
                v-slot="{ errors, processing }"
            >
                <div class="grid gap-1.5">
                    <label
                        for="current_password"
                        class="text-sm font-medium text-ss-text-2"
                        >Current password</label
                    >
                    <PasswordInput
                        id="current_password"
                        name="current_password"
                        class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                        autocomplete="current-password"
                        placeholder="Current password"
                    />
                    <InputError :message="errors.current_password" />
                </div>

                <div class="grid gap-1.5">
                    <label
                        for="password"
                        class="text-sm font-medium text-ss-text-2"
                        >New password</label
                    >
                    <PasswordInput
                        id="password"
                        name="password"
                        class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                        autocomplete="new-password"
                        placeholder="New password"
                        :passwordrules="props.passwordRules"
                    />
                    <InputError :message="errors.password" />
                </div>

                <div class="grid gap-1.5">
                    <label
                        for="password_confirmation"
                        class="text-sm font-medium text-ss-text-2"
                        >Confirm password</label
                    >
                    <PasswordInput
                        id="password_confirmation"
                        name="password_confirmation"
                        class="h-9 w-full rounded-lg border border-ss-border bg-ss-bg px-2 text-sm text-ss-text focus:border-ss-accent focus:outline-none"
                        autocomplete="new-password"
                        placeholder="Confirm password"
                        :passwordrules="props.passwordRules"
                    />
                    <InputError :message="errors.password_confirmation" />
                </div>

                <button
                    type="submit"
                    :disabled="processing"
                    data-test="update-password-button"
                    class="rounded-lg bg-ss-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                >
                    Save
                </button>
            </Form>
        </div>

        <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
            <ManageTwoFactor
                :canManageTwoFactor="canManageTwoFactor"
                :requiresConfirmation="requiresConfirmation"
                :twoFactorEnabled="twoFactorEnabled"
            />
        </div>

        <div class="rounded-xl border border-ss-border bg-ss-surface p-5">
            <ManagePasskeys
                :canManagePasskeys="canManagePasskeys"
                :passkeys="passkeys"
            />
        </div>
    </div>
</template>
