<script setup lang="ts">
// Terminal screen for a member whose access is suspended or archived. Carries the
// `auth` layout (which already exposes sign-out) and only the `auth` middleware —
// deliberately NO area guard, so a blocked member lands here without a redirect
// loop. If they're still active at another school, they can switch to it.
definePageMeta({ layout: 'auth', middleware: 'auth' })

const { t } = useI18n()
const { data: context } = await useAppContext()
const { switching, switchTo } = useOrgSwitch()

const active = computed(() => activeMembershipOf(context.value))
const status = computed<'suspended' | 'archived'>(() =>
  active.value?.status === 'archived' ? 'archived' : 'suspended'
)
const orgName = computed(() => active.value?.organization.name ?? '')
const otherActive = computed(() =>
  (context.value?.memberships ?? []).filter(m => m.status === 'active' && m.id !== active.value?.id)
)
</script>

<template>
  <div class="flex w-full flex-col items-center text-center">
    <div class="flex size-14 items-center justify-center rounded-full bg-elevated">
      <UIcon
        :name="status === 'archived' ? 'i-lucide-archive' : 'i-lucide-pause'"
        class="size-7 text-dimmed"
      />
    </div>
    <h1 class="mt-5 text-lg font-semibold text-highlighted">
      {{ t(`accessPaused.${status}.title`) }}
    </h1>
    <p class="mt-2 max-w-sm text-sm text-muted">
      {{ t(`accessPaused.${status}.description`, { org: orgName }) }}
    </p>

    <div
      v-if="otherActive.length"
      class="mt-8 w-full"
    >
      <p class="text-xs font-medium tracking-wide text-dimmed uppercase">
        {{ t('accessPaused.switchTitle') }}
      </p>
      <div class="mt-3 flex flex-col gap-2">
        <UButton
          v-for="m in otherActive"
          :key="m.id"
          color="neutral"
          variant="subtle"
          block
          :loading="switching"
          trailing-icon="i-lucide-arrow-right"
          :label="t('accessPaused.switch', { org: m.organization.name })"
          @click="switchTo(m.organization.id)"
        />
      </div>
    </div>
  </div>
</template>
