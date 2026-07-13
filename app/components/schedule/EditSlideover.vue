<script setup lang="ts">
import { DateTime } from 'luxon'
import type { CourtView } from '~/utils/courts'
import type { LessonDetail } from '~~/server/database/types'

// Edit a lesson GROUP (school): its metadata (title, colour, capacity, enrolment
// policy) plus its SLOTS — the recurrence rules it meets on. Each slot carries its
// own court, coach, time, duration and recurrence; editing/adding/removing a slot
// re-materializes just that slot's future occurrences.
const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  seriesId: string | null
  courts: CourtView[]
  coaches: { id: string, name: string }[]
}>()

const emit = defineEmits<{ saved: [] }>()

const { t } = useI18n()
const toast = useToast()
const { toastError } = useApiError()
const form = useTemplateRef('form')

// Group metadata (non-structural).
const state = reactive({
  title: '',
  color: DEFAULT_LESSON_COLOR,
  capacityMax: null as number | null,
  enrollmentOpen: true
})
const sport = ref('')
const timezone = ref('Europe/Warsaw')
const loading = ref(false)
const saving = ref(false)
let token = 0

// Slots (recurrence rules) + the inline slot editor.
const rules = ref<LessonDetail['rules']>([])
type SlotDraft = { dtStart: string, durationMin: number, courtId: string, coachMemberId: string, freq: RecurrenceFreq, byday: string[] }
const editing = ref<string | 'new' | null>(null) // rule id being edited, 'new', or none
const draft = reactive<SlotDraft>({ dtStart: '', durationMin: 60, courtId: '', coachMemberId: NO_COACH_VALUE, freq: 'none', byday: [] })
const savingSlot = ref(false)
const removingRuleId = ref<string | null>(null)

// Permanent delete of the whole group (irreversible; cascades to sessions,
// enrolments, attendance and the courts' bookings). Guarded by a confirm modal.
const deleteConfirmOpen = ref(false)
const deleting = ref(false)

const formSchema = computed(() => scheduleMetadataFormSchema(t))

async function load() {
  if (!props.seriesId) return
  const current = ++token
  loading.value = true
  try {
    const { lesson } = await $fetch<{ lesson: LessonDetail }>(`/api/school/schedule/${props.seriesId}`)
    if (current !== token) return
    const s = lesson.series
    state.title = s.title
    state.color = s.color
    state.capacityMax = s.capacityMax
    state.enrollmentOpen = s.enrollmentOpen
    sport.value = s.sport
    timezone.value = s.timezone
    rules.value = lesson.rules
    editing.value = null
  } catch (error) {
    if (current === token) toastError('schedule.edit.errors.loadFailed', error)
  } finally {
    if (current === token) loading.value = false
  }
}

watch([open, () => props.seriesId], ([isOpen]) => {
  if (isOpen && props.seriesId) load()
})

// --- Metadata save ---
async function onSubmit() {
  if (!props.seriesId) return
  saving.value = true
  try {
    await $fetch(`/api/school/schedule/${props.seriesId}`, {
      method: 'PATCH',
      body: {
        title: state.title.trim(),
        color: state.color,
        capacityMax: typeof state.capacityMax === 'number' && Number.isFinite(state.capacityMax) ? state.capacityMax : null,
        enrollmentOpen: state.enrollmentOpen
      }
    })
    toast.add({ title: t('schedule.edit.saved'), color: 'success' })
    open.value = false
    emit('saved')
  } catch (error) {
    toastError('schedule.edit.errors.saveFailed', error)
  } finally {
    saving.value = false
  }
}

// --- Slot display helpers ---
function courtName(courtId: string | null): string {
  return (courtId && props.courts.find(c => c.id === courtId)?.name) || courtUnitLabel(sport.value, t)
}
function coachName(coachMemberId: string | null): string {
  return (coachMemberId && props.coaches.find(c => c.id === coachMemberId)?.name) || t('schedule.form.noCoach')
}
function slotSummary(rule: LessonDetail['rules'][number]): string {
  const time = rule.dtStart.slice(11, 16)
  const recurrence = parseRecurrence(rule.rrule)
  if (recurrence.freq === 'none') return `${t('schedule.form.freq.none')} · ${time}`
  if (recurrence.freq === 'weekly') {
    const dt = DateTime.fromISO(rule.dtStart, { zone: timezone.value })
    const fallback = dt.isValid ? [SCHEDULE_WEEKDAYS[dt.weekday - 1]!] : []
    const days = (recurrence.byday.length ? recurrence.byday : fallback).map(d => t(`schedule.weekdays.${d}`)).join(', ')
    return `${days} · ${time}`
  }
  return `${t(`schedule.form.freq.${recurrence.freq}`)} · ${time}`
}

// --- Slot editor ---
function weekdayOf(dtStart: string): string {
  const dt = DateTime.fromISO(dtStart, { zone: timezone.value })
  return dt.isValid ? SCHEDULE_WEEKDAYS[dt.weekday - 1]! : 'MO'
}

function startAdd() {
  const forSport = props.courts.filter(c => c.sport === sport.value && c.archivedAt === null)
  const start = DateTime.now().setZone(timezone.value).plus({ days: 1 }).set({ hour: 17, minute: 0, second: 0 })
  Object.assign(draft, {
    dtStart: localDateTimeStamp(start),
    durationMin: 60,
    courtId: forSport[0]?.id ?? '',
    coachMemberId: NO_COACH_VALUE,
    freq: 'none',
    byday: []
  })
  editing.value = 'new'
}

function startEdit(rule: LessonDetail['rules'][number]) {
  const recurrence = parseRecurrence(rule.rrule)
  Object.assign(draft, {
    dtStart: rule.dtStart,
    durationMin: rule.durationMin,
    courtId: rule.courtId ?? '',
    coachMemberId: rule.coachMemberId ?? NO_COACH_VALUE,
    freq: recurrence.freq,
    byday: recurrence.byday
  })
  editing.value = rule.id
}

function cancelSlot() {
  editing.value = null
}

async function saveSlot() {
  if (!props.seriesId || !editing.value) return
  savingSlot.value = true
  const body = {
    dtStart: draft.dtStart,
    durationMin: draft.durationMin,
    courtId: draft.courtId,
    coachMemberId: draft.coachMemberId !== NO_COACH_VALUE ? draft.coachMemberId : undefined,
    rrule: buildRRule(draft.freq, draft.byday, weekdayOf(draft.dtStart)) ?? undefined
  }
  try {
    const isNew = editing.value === 'new'
    const url = isNew
      ? `/api/school/schedule/${props.seriesId}/rules`
      : `/api/school/schedule/${props.seriesId}/rules/${editing.value}`
    const { lesson } = await $fetch<{ lesson: LessonDetail }>(url, { method: isNew ? 'POST' : 'PATCH', body })
    rules.value = lesson.rules
    editing.value = null
    toast.add({ title: t(isNew ? 'schedule.edit.slotAdded' : 'schedule.edit.slotSaved'), color: 'success' })
    emit('saved')
  } catch (error) {
    toastError('schedule.edit.errors.slotFailed', error)
  } finally {
    savingSlot.value = false
  }
}

async function removeSlot(rule: LessonDetail['rules'][number]) {
  if (!props.seriesId || removingRuleId.value) return
  removingRuleId.value = rule.id
  try {
    const { lesson } = await $fetch<{ lesson: LessonDetail }>(`/api/school/schedule/${props.seriesId}/rules/${rule.id}`, { method: 'DELETE' })
    rules.value = lesson.rules
    if (editing.value === rule.id) editing.value = null
    toast.add({ title: t('schedule.edit.slotRemoved'), color: 'neutral' })
    emit('saved')
  } catch (error) {
    toastError('schedule.edit.errors.removeSlotFailed', error)
  } finally {
    removingRuleId.value = null
  }
}

// --- Delete the whole group (hard delete) ---
async function confirmDelete() {
  if (!props.seriesId) return
  deleting.value = true
  // Annotated as string so typed $fetch doesn't intersect this dynamic path with
  // its sibling sub-routes (which would narrow the allowed method).
  const endpoint: string = `/api/school/schedule/${props.seriesId}?purge=1`
  try {
    await $fetch(endpoint, { method: 'DELETE' })
    toast.add({ title: t('schedule.edit.deleted'), color: 'neutral' })
    deleteConfirmOpen.value = false
    open.value = false
    emit('saved')
  } catch (error) {
    toastError('schedule.edit.errors.deleteFailed', error)
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="t('schedule.edit.title')"
    :description="t('schedule.edit.subtitle')"
    :ui="{ content: 'max-w-xl w-full' }"
  >
    <template #body>
      <div
        v-if="loading"
        class="flex flex-col gap-5"
      >
        <USkeleton class="h-10 w-full" />
        <USkeleton class="h-10 w-full" />
        <USkeleton class="h-24 w-full" />
      </div>

      <div
        v-else
        class="flex flex-col gap-6"
      >
        <UForm
          ref="form"
          :state="state"
          :schema="formSchema"
          class="flex flex-col gap-5"
          @submit="onSubmit"
        >
          <UFormField
            :label="t('schedule.form.title')"
            name="title"
            required
          >
            <UInput
              v-model="state.title"
              size="lg"
              class="w-full"
              :placeholder="t('schedule.form.titlePlaceholder')"
            />
          </UFormField>

          <div class="grid gap-5 sm:grid-cols-2">
            <UFormField
              :label="t('schedule.form.capacityMax')"
              name="capacityMax"
              :help="t('schedule.form.capacityHelp')"
            >
              <UInput
                v-model.number="state.capacityMax"
                type="number"
                :min="1"
                size="lg"
                class="w-full"
                :placeholder="t('schedule.form.capacityNone')"
              />
            </UFormField>
            <UFormField
              :label="t('schedule.form.color')"
              name="color"
            >
              <div class="flex flex-wrap items-center gap-2">
                <button
                  v-for="preset in LESSON_COLOR_PRESETS"
                  :key="preset"
                  type="button"
                  class="size-7 rounded-full ring-2 transition-transform"
                  :style="{ backgroundColor: preset }"
                  :class="state.color.toLowerCase() === preset.toLowerCase() ? 'ring-primary scale-110' : 'ring-transparent hover:scale-105'"
                  :aria-label="preset"
                  @click="state.color = preset"
                />
              </div>
            </UFormField>
          </div>

          <UFormField name="enrollmentOpen">
            <div class="flex items-center justify-between gap-4 rounded-lg bg-elevated/40 px-4 py-3 ring-1 ring-default">
              <div class="min-w-0">
                <p class="text-sm font-medium text-highlighted">
                  {{ t('schedule.form.enrollmentOpen') }}
                </p>
                <p class="mt-0.5 text-xs text-muted">
                  {{ t('schedule.form.enrollmentOpenHelp') }}
                </p>
              </div>
              <USwitch v-model="state.enrollmentOpen" />
            </div>
          </UFormField>
        </UForm>

        <!-- Slots -->
        <div class="flex flex-col gap-3 border-t border-default pt-5">
          <div class="min-w-0">
            <h3 class="text-sm font-semibold text-highlighted">
              {{ t('schedule.form.slots') }}
            </h3>
            <p class="mt-0.5 text-xs text-muted">
              {{ t('schedule.form.slotsHelp') }}
            </p>
          </div>

          <ul class="flex flex-col gap-2">
            <li
              v-for="rule in rules"
              :key="rule.id"
              class="rounded-lg bg-elevated/40 ring-1 ring-default"
            >
              <div class="flex items-center justify-between gap-3 px-3 py-2">
                <div class="min-w-0">
                  <p class="truncate text-sm font-medium text-highlighted">
                    {{ slotSummary(rule) }}
                  </p>
                  <p class="mt-0.5 flex items-center gap-2 truncate text-xs text-muted">
                    <span class="inline-flex items-center gap-1">
                      <UIcon
                        name="i-lucide-land-plot"
                        class="size-3"
                      />
                      {{ courtName(rule.courtId) }}
                    </span>
                    <span class="inline-flex items-center gap-1">
                      <UIcon
                        name="i-lucide-user-round"
                        class="size-3"
                      />
                      {{ coachName(rule.coachMemberId) }}
                    </span>
                  </p>
                </div>
                <div class="flex shrink-0 items-center gap-1">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-pencil"
                    :aria-label="t('schedule.edit.editSlot')"
                    :disabled="editing !== null"
                    @click="startEdit(rule)"
                  />
                  <UButton
                    v-if="rules.length > 1"
                    color="neutral"
                    variant="ghost"
                    size="xs"
                    icon="i-lucide-trash-2"
                    :aria-label="t('schedule.form.removeSlot')"
                    :loading="removingRuleId === rule.id"
                    :disabled="editing !== null"
                    @click="removeSlot(rule)"
                  />
                </div>
              </div>

              <!-- Inline editor for this slot -->
              <div
                v-if="editing === rule.id"
                class="flex flex-col gap-4 border-t border-default p-4"
              >
                <p class="flex items-start gap-2 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning ring-1 ring-warning/20">
                  <UIcon
                    name="i-lucide-triangle-alert"
                    class="mt-0.5 size-4 shrink-0"
                  />
                  {{ t('schedule.edit.slotWarning') }}
                </p>
                <ScheduleRuleFields
                  v-model:dt-start="draft.dtStart"
                  v-model:duration-min="draft.durationMin"
                  v-model:court-id="draft.courtId"
                  v-model:coach-member-id="draft.coachMemberId"
                  v-model:freq="draft.freq"
                  v-model:byday="draft.byday"
                  :courts="courts"
                  :coaches="coaches"
                  :sport="sport"
                  :timezone="timezone"
                  size="md"
                />
                <div class="flex justify-end gap-2">
                  <UButton
                    color="neutral"
                    variant="ghost"
                    :label="t('common.cancel')"
                    @click="cancelSlot"
                  />
                  <PressButton
                    :block="false"
                    size="md"
                    icon="i-lucide-check"
                    :loading="savingSlot"
                    :label="t('schedule.edit.saveSlot')"
                    @click="saveSlot"
                  />
                </div>
              </div>
            </li>
          </ul>

          <!-- Add-slot editor -->
          <div
            v-if="editing === 'new'"
            class="flex flex-col gap-4 rounded-lg bg-elevated/40 p-4 ring-1 ring-default"
          >
            <span class="text-xs font-semibold uppercase tracking-wide text-dimmed">
              {{ t('schedule.edit.newSlot') }}
            </span>
            <ScheduleRuleFields
              v-model:dt-start="draft.dtStart"
              v-model:duration-min="draft.durationMin"
              v-model:court-id="draft.courtId"
              v-model:coach-member-id="draft.coachMemberId"
              v-model:freq="draft.freq"
              v-model:byday="draft.byday"
              :courts="courts"
              :coaches="coaches"
              :sport="sport"
              :timezone="timezone"
              size="md"
            />
            <div class="flex justify-end gap-2">
              <UButton
                color="neutral"
                variant="ghost"
                :label="t('common.cancel')"
                @click="cancelSlot"
              />
              <PressButton
                :block="false"
                size="md"
                icon="i-lucide-check"
                :loading="savingSlot"
                :label="t('schedule.edit.saveSlot')"
                @click="saveSlot"
              />
            </div>
          </div>

          <UButton
            v-if="editing === null"
            color="neutral"
            variant="subtle"
            size="sm"
            icon="i-lucide-plus"
            :label="t('schedule.form.addSlot')"
            class="self-start"
            @click="startAdd"
          />
        </div>

        <!-- Danger zone -->
        <div class="flex flex-col gap-3 border-t border-default pt-5">
          <div class="min-w-0">
            <h3 class="text-sm font-semibold text-error">
              {{ t('schedule.edit.dangerZone') }}
            </h3>
            <p class="mt-0.5 text-xs text-muted">
              {{ t('schedule.edit.dangerZoneHelp') }}
            </p>
          </div>
          <UButton
            color="error"
            variant="subtle"
            size="sm"
            icon="i-lucide-trash-2"
            :label="t('schedule.edit.delete')"
            class="self-start"
            :disabled="editing !== null"
            @click="deleteConfirmOpen = true"
          />
        </div>
      </div>
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
          icon="i-lucide-check"
          :loading="saving"
          :disabled="loading"
          :label="t('common.save')"
          @click="form?.submit()"
        />
      </div>
    </template>
  </USlideover>

  <UModal
    :open="deleteConfirmOpen"
    :title="t('schedule.edit.deleteConfirm.title')"
    :description="t('schedule.edit.deleteConfirm.description', { title: state.title })"
    @update:open="(value: boolean) => { if (!value) deleteConfirmOpen = false }"
  >
    <template #body>
      <UAlert
        color="error"
        variant="subtle"
        icon="i-lucide-triangle-alert"
        :title="t('schedule.edit.deleteConfirm.warningTitle')"
        :description="t('schedule.edit.deleteConfirm.warningBody')"
      />
    </template>
    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton
          color="neutral"
          variant="ghost"
          :label="t('common.cancel')"
          @click="deleteConfirmOpen = false"
        />
        <UButton
          color="error"
          icon="i-lucide-trash-2"
          :loading="deleting"
          :label="t('schedule.edit.delete')"
          @click="confirmDelete"
        />
      </div>
    </template>
  </UModal>
</template>
