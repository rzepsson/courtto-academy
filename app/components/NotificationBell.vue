<script setup lang="ts">
const { t } = useI18n()
const { notifications, unreadCount, pending, markAllRead, dismiss, clearAll } = useNotifications()

const open = ref(false)

const hasDismissible = computed(() => notifications.value.some(n => n.dismissible))
const badgeText = computed(() => (unreadCount.value > 99 ? '99+' : String(unreadCount.value)))

// Opening the bell is the "seen" signal: clear the unread badge.
watch(open, (isOpen) => {
  if (isOpen && unreadCount.value > 0) {
    markAllRead()
  }
})

async function onSelect(link: string | null) {
  open.value = false
  if (link) {
    await navigateTo(link)
  }
}
</script>

<template>
  <UPopover
    v-model:open="open"
    :content="{ align: 'end', sideOffset: 8 }"
  >
    <UChip
      :text="badgeText"
      :show="unreadCount > 0"
      color="primary"
      size="2xl"
    >
      <UButton
        icon="i-lucide-bell"
        color="neutral"
        variant="ghost"
        :aria-label="t('notifications.title')"
      />
    </UChip>

    <template #content>
      <div class="flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col">
        <div class="flex items-center justify-between gap-2 border-b border-default px-4 py-3">
          <p class="text-sm font-semibold text-highlighted">
            {{ t('notifications.title') }}
          </p>
          <UButton
            v-if="hasDismissible"
            :label="t('notifications.clearAll')"
            color="neutral"
            variant="ghost"
            size="xs"
            @click="clearAll"
          />
        </div>

        <div class="max-h-[26rem] overflow-y-auto p-1.5">
          <div
            v-if="pending && notifications.length === 0"
            class="flex flex-col gap-2 p-2"
          >
            <USkeleton
              v-for="i in 3"
              :key="i"
              class="h-16 w-full"
            />
          </div>

          <div
            v-else-if="notifications.length === 0"
            class="flex flex-col items-center gap-2 px-4 py-10 text-center"
          >
            <div class="flex size-11 items-center justify-center rounded-full bg-elevated">
              <UIcon
                name="i-lucide-bell-off"
                class="size-5 text-dimmed"
              />
            </div>
            <p class="text-sm text-muted">
              {{ t('notifications.empty') }}
            </p>
          </div>

          <NotificationItem
            v-for="notification in notifications"
            v-else
            :key="notification.id"
            :notification="notification"
            @select="onSelect(notification.link)"
            @dismiss="dismiss(notification.id)"
          />
        </div>
      </div>
    </template>
  </UPopover>
</template>
