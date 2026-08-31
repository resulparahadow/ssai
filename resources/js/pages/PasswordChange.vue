<script setup lang="ts">
import { Form, Head, Link } from '@inertiajs/vue3';
import InputError from '@/components/InputError.vue';
import PasswordInput from '@/components/PasswordInput.vue';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { logout } from '@/routes';

defineOptions({
    layout: {
        title: 'Set a new password',
        description:
            'Your account requires a new password before you can continue.',
    },
});
</script>

<template>
    <Head title="Set a new password" />

    <Form
        method="put"
        action="/password/change"
        reset-on-success
        v-slot="{ errors, processing }"
    >
        <div class="space-y-6">
            <div class="grid gap-2">
                <Label for="password">New password</Label>
                <PasswordInput
                    id="password"
                    name="password"
                    class="mt-1 block w-full"
                    required
                    autocomplete="new-password"
                    autofocus
                    placeholder="New password"
                />
                <InputError :message="errors.password" />
            </div>

            <div class="grid gap-2">
                <Label for="password_confirmation">Confirm password</Label>
                <PasswordInput
                    id="password_confirmation"
                    name="password_confirmation"
                    class="mt-1 block w-full"
                    required
                    autocomplete="new-password"
                    placeholder="Confirm password"
                />
                <InputError :message="errors.password_confirmation" />
            </div>

            <Button class="w-full" :disabled="processing">
                Update password
            </Button>

            <div class="text-center text-sm text-muted-foreground">
                <Link :href="logout()" as="button" class="underline">
                    Log out
                </Link>
            </div>
        </div>
    </Form>
</template>
