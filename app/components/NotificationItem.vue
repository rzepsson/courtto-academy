<script setup lang="ts">
import type { NotificationDto } from '~~/server/database/types'
import { formatRelativeTime } from '~/utils/format'

const props = defineProps<{ notification: NotificationDto }>()
const emit = defineEmits<{ select: [], dismiss: [] }>()

const { t, te, locale } = useI18n()

// Per-type icon; unknown types fall back to a generic bell.
const ICONS: Record<string, string> = {
  'org.setup_incomplete': 'i-lucide-building-2',
  'lesson.cancelled': 'i-lucide-calendar-x',
  'lesson.rescheduled': 'i-lucide-calendar-clock',
  'lesson.reminder': 'i-lucide-calendar-check',
  'enrollment.waitlist_promoted': 'i-lucide-user-check',
  'billing.payment_failed': 'i-lucide-credit-card'
}

const icon = computed(() => ICONS[props.notification.type] ?? 'i-lucide-bell')

// Copy is rendered here (never stored): resolve the type's localized title/body,
// interpolating the row's `data`, and fall back to a generic key for unknown
// types so a future server type never renders a raw key.
function localized(kind: 'title' | 'body') {
  const key = `notifications.types.${props.notification.type}.${kind}`
  return te(key) ? t(key, { ...props.notification.data }) : t(`notifications.fallback.${kind}`)
}

const title = computed(() => localized('title'))
const body = computed(() => localized('body'))
const time = computed(() => formatRelativeTime(props.notification.createdAt, locale.value))
const clickable = computed(() => Boolean(props.notification.link))
</script>

<template>
  <div
    class="group relative flex gap-3 rounded-lg p-3 transition-colors"
    :class="[
      notification.read ? '' : 'bg-primary/5',
      clickable ? 'cursor-pointer hover:bg-elevated' : ''
    ]"
    :role="clickable ? 'button' : undefined"
    :tabindex="clickable ? 0 : undefined"
    @click="clickable && emit('select')"
    @keydown.enter="clickable && emit('select')"
  >
    <div class="flex size-9 shrink-0 items-center justify-center rounded-full bg-elevated">
      <UIcon
        :name="icon"
        class="size-5 text-primary"
      />
    </div>

    <div class="min-w-0 flex-1">
      <div class="flex items-start gap-2">
        <p class="flex-1 text-sm font-medium text-highlighted">
          {{ title }}
        </p>
        <span
          v-if="!notification.read"
          class="mt-1.5 size-2 shrink-0 rounded-full bg-primary"
          aria-hidden="true"
        />
      </div>
      <p class="mt-0.5 text-sm text-muted">
        {{ body }}
      </p>
      <p class="mt-1 text-xs text-dimmed">
        {{ time }}
      </p>
    </div>

    <UButton
      v-if="notification.dismissible"
      icon="i-lucide-x"
      color="neutral"
      variant="ghost"
      size="xs"
      :aria-label="t('notifications.dismiss')"
      class="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
      @click.stop="emit('dismiss')"
    />
  </div>
</template>
