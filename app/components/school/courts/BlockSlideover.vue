<script setup lang="ts">
import { DateTime } from 'luxon'
import type { CourtView } from '~/utils/courts'

// Take a court out of service for a range — a maintenance window / closure. It
// writes a standalone core reservation (no lesson), which the kind-agnostic
// court-overlap constraint then enforces against lessons. Binds the shared
// courtBlockFormSchema the server validates the POST body against. Defaults to a
// whole-day closure (the headline "resurface Court 3 for a few days" case); a
// toggle switches to specific start/end times.
const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  court: CourtView | null
  timezone: string
}>()

const emit = defineEmits<{ saved: [] }>()

const { t, locale } = useI18n()
const toast = useToast()
const { toastError } = useApiError()
const form = useTemplateRef('form')

// The unit noun follows the court's sport, so blocking a table reads "table"/"stół".
// `unitLower` (accusative) fills the imperative title/submit ("Block a …"); the
// capitalized form heads the success toast ("… blocked"). Both current units
// (court, table) are grammatically masculine in PL, so the toast's adjective
// agreement holds — revisit if a neuter unit (e.g. "boisko") is ever added.
const unitLabel = computed(() => courtUnitLabel(props.court?.sport ?? 'tennis', t))
const unitLower = computed(() => unitLabel.value.toLocaleLowerCase(locale.value))

// state carries the schema's own fields (startLocal/endLocal/kind/title) so
// UForm maps validation errors by name; `allDay` is a UI-only convenience Zod
// ignores. Wall-clock stamps are 'yyyy-MM-ddTHH:mm', resolved server-side in the
// facility timezone. In all-day mode endLocal is EXCLUSIVE (00:00 of the day
// after the last blocked day); the inclusive end date is shown via a computed.
const state = reactive({
  kind: 'maintenance',
  allDay: true,
  startLocal: '',
  endLocal: '',
  title: ''
})
const saving = ref(false)

function dateOf(local: string): string {
  return local.split('T')[0] ?? ''
}
function today(): string {
  return DateTime.now().setZone(props.timezone).toFormat('yyyy-MM-dd')
}

function initForm() {
  const start = today()
  state.kind = 'maintenance'
  state.allDay = true
  state.startLocal = `${start}T00:00`
  state.endLocal = `${DateTime.fromISO(start).plus({ days: 1 }).toFormat('yyyy-MM-dd')}T00:00`
  state.title = ''
}

watch(open, (value) => {
  if (value) initForm()
})

// All-day ⟷ timed: recompute the two stamps from the current dates so no state
// is lost across the toggle. timed→all-day treats the end's DATE as the last
// inclusive day; all-day→timed drops to a sensible same-day 09:00–11:00.
function setAllDay(value: boolean) {
  state.allDay = value
  const startD = dateOf(state.startLocal) || today()
  if (value) {
    const endD = dateOf(state.endLocal) || startD
    const lastDay = endD < startD ? startD : endD
    state.startLocal = `${startD}T00:00`
    state.endLocal = `${DateTime.fromISO(lastDay).plus({ days: 1 }).toFormat('yyyy-MM-dd')}T00:00`
  } else {
    state.startLocal = `${startD}T09:00`
    state.endLocal = `${startD}T11:00`
  }
}

const startDate = computed({
  get: () => dateOf(state.startLocal),
  set: (d: string) => {
    if (d) state.startLocal = `${d}T00:00`
  }
})
// Shown inclusive (the last blocked day); stored exclusive (day after).
const endDateInclusive = computed({
  get: () => {
    const d = dateOf(state.endLocal)
    return d ? DateTime.fromISO(d).minus({ days: 1 }).toFormat('yyyy-MM-dd') : ''
  },
  set: (d: string) => {
    if (d) state.endLocal = `${DateTime.fromISO(d).plus({ days: 1 }).toFormat('yyyy-MM-dd')}T00:00`
  }
})

const kindOptions = computed(() => courtBlockKindOptions(t))
const formSchema = computed(() => courtBlockFormSchema(t))

const preview = computed(() => {
  const start = DateTime.fromISO(state.startLocal, { zone: props.timezone }).setLocale(locale.value)
  const end = DateTime.fromISO(state.endLocal, { zone: props.timezone }).setLocale(locale.value)
  if (!start.isValid || !end.isValid || end <= start) return ''
  if (state.allDay) {
    const last = end.minus({ days: 1 })
    return last.hasSame(start, 'day')
      ? start.toFormat('cccc, d LLLL yyyy')
      : `${start.toFormat('d LLL')} – ${last.toFormat('d LLL yyyy')}`
  }
  return end.hasSame(start, 'day')
    ? `${start.toFormat('d LLL, HH:mm')} – ${end.toFormat('HH:mm')}`
    : `${start.toFormat('d LLL HH:mm')} – ${end.toFormat('d LLL HH:mm')}`
})

async function onSubmit() {
  if (!props.court) return
  saving.value = true
  const endpoint: string = `/api/school/courts/${props.court.id}/blocks`
  try {
    await $fetch(endpoint, {
      method: 'POST',
      body: {
        kind: state.kind,
        startLocal: state.startLocal,
        endLocal: state.endLocal,
        title: state.title.trim() || undefined
      }
    })
    toast.add({ title: t('schedule.blocks.created', { unit: unitLabel.value }), color: 'success' })
    open.value = false
    emit('saved')
  } catch (error) {
    toastError('schedule.blocks.errors.saveFailed', error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="t('schedule.blocks.form.title', { unit: unitLower })"
    :description="court ? t('schedule.blocks.form.subtitle', { name: court.name }) : ''"
    :ui="{ content: 'max-w-lg w-full' }"
  >
    <template #body>
      <UForm
        ref="form"
        :state="state"
        :schema="formSchema"
        class="flex flex-col gap-5"
        @submit="onSubmit"
      >
        <UFormField
          :label="t('schedule.blocks.form.kind')"
          name="kind"
        >
          <USelect
            v-model="state.kind"
            value-key="value"
            :items="kindOptions"
            size="lg"
            class="w-full"
          />
        </UFormField>

        <div class="flex items-center justify-between gap-4 rounded-lg bg-elevated/40 px-4 py-3 ring-1 ring-default">
          <div class="min-w-0">
            <p class="text-sm font-medium text-highlighted">
              {{ t('schedule.blocks.form.allDay') }}
            </p>
            <p class="mt-0.5 text-xs text-muted">
              {{ t('schedule.blocks.form.allDayHelp') }}
            </p>
          </div>
          <USwitch
            :model-value="state.allDay"
            @update:model-value="setAllDay"
          />
        </div>

        <!-- All-day: inclusive start/end dates -->
        <div
          v-if="state.allDay"
          class="grid gap-4 sm:grid-cols-2"
        >
          <UFormField
            :label="t('schedule.blocks.form.startDate')"
            name="startLocal"
            required
          >
            <AppDatePicker
              v-model="startDate"
              size="lg"
              block
              class="w-full"
            />
          </UFormField>
          <UFormField
            :label="t('schedule.blocks.form.endDate')"
            name="endLocal"
            required
          >
            <AppDatePicker
              v-model="endDateInclusive"
              size="lg"
              block
              class="w-full"
            />
          </UFormField>
        </div>

        <!-- Timed: start/end date+time -->
        <div
          v-else
          class="flex flex-col gap-4"
        >
          <UFormField
            :label="t('schedule.blocks.form.start')"
            name="startLocal"
            required
          >
            <AppDateTimeField
              v-model="state.startLocal"
              size="lg"
            />
          </UFormField>
          <UFormField
            :label="t('schedule.blocks.form.end')"
            name="endLocal"
            required
          >
            <AppDateTimeField
              v-model="state.endLocal"
              size="lg"
            />
          </UFormField>
        </div>

        <UFormField
          :label="t('schedule.blocks.form.label')"
          name="title"
          :help="t('schedule.blocks.form.labelHelp')"
        >
          <UInput
            v-model="state.title"
            size="lg"
            class="w-full"
            :placeholder="t('schedule.blocks.form.labelPlaceholder')"
          />
        </UFormField>

        <div
          v-if="preview"
          class="flex items-start gap-2 rounded-lg bg-elevated/40 px-4 py-3 text-sm ring-1 ring-default"
        >
          <UIcon
            name="i-lucide-calendar-clock"
            class="mt-0.5 size-4 shrink-0 text-dimmed"
          />
          <span class="text-muted">{{ preview }}</span>
        </div>
      </UForm>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          :label="t('common.cancel')"
          @click="open = false"
        />
        <PressButton
          :block="false"
          size="md"
          icon="i-lucide-wrench"
          :loading="saving"
          :label="t('schedule.blocks.form.submit', { unit: unitLower })"
          @click="form?.submit()"
        />
      </div>
    </template>
  </USlideover>
</template>
