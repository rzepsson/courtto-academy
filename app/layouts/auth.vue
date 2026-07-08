<script setup lang="ts">
const { t } = useI18n()
const year = new Date().getFullYear()

// Non-blocking (no await): the sign-out control only appears once a session
// resolves, so we don't wrap the whole auth layout in a Suspense boundary that
// would also gate login/register rendering.
const { data: session } = useAuthSession()
const { signingOut, signOut } = useSignOut()
</script>

<template>
  <div class="relative flex min-h-screen flex-col items-center px-6 pb-16 pt-[max(4rem,14vh)]">
    <div
      v-if="session"
      class="absolute top-5 left-5"
    >
      <UTooltip :text="t('auth.signOut')">
        <UButton
          icon="i-lucide-log-out"
          color="neutral"
          variant="ghost"
          :loading="signingOut"
          :aria-label="t('auth.signOut')"
          @click="signOut"
        />
      </UTooltip>
    </div>

    <div class="absolute top-5 right-5 flex items-center gap-2">
      <LocaleSwitcher />
      <ColorModeButton />
    </div>

    <main class="flex w-full max-w-sm flex-col items-center">
      <BrandMark />

      <MotionConfig reduced-motion="user">
        <div class="mt-10 w-full">
          <slot />
        </div>
      </MotionConfig>
    </main>

    <p class="absolute bottom-6 text-xs text-dimmed">
      © {{ year }} {{ t('brand.name') }}
    </p>
  </div>
</template>
