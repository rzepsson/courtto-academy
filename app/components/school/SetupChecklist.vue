<script setup lang="ts">
import { REQUIRED_PROFILE_FIELDS, type RequiredProfileField } from '~~/shared/org-profile'

// Onboarding aid mirroring the `org.setup_incomplete` notification: the four
// fields a school must fill in before it's ready to operate, each linking to the
// settings section that owns it. Driven by the same computeProfileCompletion()
// result, so the checklist, the notification and readiness never disagree.
const props = defineProps<{ missing: RequiredProfileField[] }>()
const emit = defineEmits<{ navigate: [section: string] }>()

const { t } = useI18n()

// Field → owning settings section + icon + reused label key. Order follows
// REQUIRED_PROFILE_FIELDS so the list reads the same as readiness is computed.
const FIELD_META: Record<RequiredProfileField, { section: string, icon: string, label: string }> = {
  contactEmail: { section: 'contact', icon: 'i-lucide-mail', label: 'school.settings.contact.email' },
  sports: { section: 'public', icon: 'i-lucide-medal', label: 'school.settings.publicProfile.sports' },
  city: { section: 'location', icon: 'i-lucide-building', label: 'school.settings.location.city' },
  country: { section: 'location', icon: 'i-lucide-flag', label: 'school.settings.location.country' }
}

const items = computed(() =>
  REQUIRED_PROFILE_FIELDS.map(field => ({
    field,
    ...FIELD_META[field],
    done: !props.missing.includes(field)
  }))
)

const doneCount = computed(() => items.value.filter(i => i.done).length)
const total = REQUIRED_PROFILE_FIELDS.length
</script>

<template>
  <div class="rounded-xl bg-primary/5 p-5 ring-1 ring-primary/20 sm:p-6">
    <div class="flex items-start gap-4">
      <div class="hidden size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 sm:flex">
        <UIcon
          name="i-lucide-rocket"
          class="size-5 text-primary"
        />
      </div>

      <div class="min-w-0 flex-1">
        <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <h2 class="font-semibold text-highlighted">
            {{ t('school.settings.checklist.title') }}
          </h2>
          <span class="text-sm font-medium text-primary">
            {{ t('school.settings.checklist.progress', { done: doneCount, total }) }}
          </span>
        </div>
        <p class="mt-1 text-sm text-muted">
          {{ t('school.settings.checklist.subtitle') }}
        </p>

        <ul class="mt-4 flex flex-col gap-1.5">
          <li
            v-for="item in items"
            :key="item.field"
          >
            <button
              type="button"
              class="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors"
              :class="item.done
                ? 'text-muted'
                : 'text-default hover:bg-primary/10'"
              @click="emit('navigate', item.section)"
            >
              <UIcon
                :name="item.done ? 'i-lucide-check-circle-2' : 'i-lucide-circle'"
                class="size-5 shrink-0"
                :class="item.done ? 'text-primary' : 'text-dimmed'"
              />
              <span
                class="flex-1 font-medium"
                :class="item.done ? 'line-through decoration-muted' : ''"
              >
                {{ t(item.label) }}
              </span>
              <UIcon
                v-if="!item.done"
                name="i-lucide-arrow-right"
                class="size-4 shrink-0 text-dimmed"
              />
            </button>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
