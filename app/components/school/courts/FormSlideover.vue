<script setup lang="ts">
import type { CourtView } from '~/utils/courts'
import type { Sport } from '~~/shared/org-profile'

// The two-pane court builder: form on the left, a live CourtsDiagram preview on
// the right (top on mobile). Handles both create and edit. The discipline list
// is constrained to the facility's offered sports (passed in), and the server
// re-validates everything.
const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  court: CourtView | null
  allowedSports: string[]
  // The facility's zones — the discipline's grouping picker. Empty = no zones yet.
  zones?: CourtZoneView[]
}>()

const emit = defineEmits<{ saved: [] }>()

const { t, locale } = useI18n()
const toast = useToast()
const { toastError } = useApiError()

const form = useTemplateRef('form')
const isEdit = computed(() => props.court !== null)

// The unit noun follows the selected discipline ("Court"/"Table"), so building a
// table tennis table reads "table"/"stół" throughout the slideover. Lowercase
// (accusative) for the imperative title/button, capitalized to head the toast.
const unitLabel = computed(() => courtUnitLabel(state.sport, t))
const unitLower = computed(() => unitLabel.value.toLocaleLowerCase(locale.value))

const state = reactive<CourtFormState>({
  name: '', sport: 'tennis', surface: '', environment: 'indoor',
  surfaceColor: '#2f6db5', lineColor: DEFAULT_LINE_COLOR, zoneId: NO_ZONE_VALUE, notes: ''
})
const saving = ref(false)

function initForm() {
  const c = props.court
  const sport = c?.sport ?? props.allowedSports[0] ?? 'tennis'
  state.name = c?.name ?? ''
  state.sport = sport
  state.surface = c?.surface ?? ''
  state.environment = c?.environment ?? 'indoor'
  state.surfaceColor = c?.surfaceColor ?? DEFAULT_SURFACE_COLOR[sport as Sport] ?? '#2f6db5'
  state.lineColor = c?.lineColor ?? DEFAULT_LINE_COLOR
  state.zoneId = c?.zoneId ?? NO_ZONE_VALUE
  state.notes = c?.notes ?? ''
}

watch(open, (value) => {
  if (value) initForm()
})

// Discipline changes ripple into surface + colour.
watch(() => state.sport, (next, prev) => {
  if (state.surface && !isValidSurfaceFor(next as Sport, state.surface)) {
    state.surface = ''
  }
  // Only swap the surface colour if the user hasn't picked a custom one (i.e. it
  // still equals the previous discipline's default).
  if (prev && state.surfaceColor === DEFAULT_SURFACE_COLOR[prev as Sport]) {
    state.surfaceColor = DEFAULT_SURFACE_COLOR[next as Sport] ?? state.surfaceColor
  }
})

const sportChips = computed(() => props.allowedSports.filter(isCourtSport))
const surfaceOptions = computed(() => courtSurfaceOptions(state.sport, t))
const showSurface = computed(() => surfaceOptions.value.length > 0)
const environmentOptions = computed(() => courtEnvironmentOptions(t))

// "No zone" sentinel first, then the facility's zones. The sentinel maps back to
// null on submit (an empty-string item value breaks USelectMenu — see NO_ZONE_VALUE).
const zoneOptions = computed(() => [
  { value: NO_ZONE_VALUE, label: t('courts.form.zoneNone') },
  ...(props.zones ?? []).map(z => ({ value: z.id, label: z.name }))
])

const lineColorPresets = ['#ffffff', '#0f172a', '#facc15']

// The same shared Zod schema the server validates against (rebuilt per-locale).
const formSchema = computed(() => courtFormSchema(t))

async function onSubmit() {
  saving.value = true

  const body: Record<string, unknown> = {
    name: state.name.trim(),
    sport: state.sport,
    environment: state.environment,
    surfaceColor: state.surfaceColor,
    lineColor: state.lineColor,
    zoneId: state.zoneId === NO_ZONE_VALUE ? null : state.zoneId,
    notes: state.notes.trim()
  }
  // Only send surface for disciplines that have one; otherwise leave it null.
  if (showSurface.value) {
    body.surface = state.surface || null
  }

  try {
    if (props.court) {
      await $fetch(`/api/school/courts/${props.court.id}`, { method: 'PATCH', body })
    } else {
      await $fetch('/api/school/courts', { method: 'POST', body })
    }
    toast.add({ title: t(isEdit.value ? 'courts.form.updated' : 'courts.form.created', { unit: unitLabel.value }), color: 'success' })
    open.value = false
    emit('saved')
  } catch (error) {
    toastError('courts.form.errors.saveFailed', error)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="isEdit ? t('courts.form.editTitle', { unit: unitLower }) : t('courts.form.createTitle', { unit: unitLower })"
    :description="t('courts.form.subtitle')"
    :ui="{ content: 'max-w-3xl w-full' }"
  >
    <template #body>
      <div class="flex flex-col gap-6 lg:h-full lg:flex-row lg:gap-8">
        <!-- Live preview (top on mobile, right on desktop) -->
        <div class="order-1 lg:order-2 lg:w-[42%] lg:shrink-0">
          <div class="lg:sticky lg:top-0 flex flex-col gap-3">
            <div class="overflow-hidden rounded-xl ring-1 ring-default">
              <div class="aspect-16/11 w-full bg-elevated">
                <CourtsDiagram
                  :sport="state.sport"
                  :surface-color="state.surfaceColor"
                  :line-color="state.lineColor"
                />
              </div>
            </div>
            <div class="px-1">
              <p class="truncate text-sm font-medium text-highlighted">
                {{ state.name.trim() || t('courts.form.previewName', { unit: unitLower }) }}
              </p>
            </div>
          </div>
        </div>

        <!-- Form -->
        <UForm
          ref="form"
          :state="state"
          :schema="formSchema"
          class="order-2 flex min-w-0 flex-1 flex-col gap-5 lg:order-1"
          @submit="onSubmit"
        >
          <UFormField
            :label="t('courts.form.name')"
            name="name"
            required
          >
            <UInput
              v-model="state.name"
              size="lg"
              class="w-full"
              :placeholder="t('courts.form.namePlaceholder', { unit: unitLabel })"
              autofocus
            />
          </UFormField>

          <UFormField
            :label="t('courts.form.sport')"
            name="sport"
          >
            <div class="flex flex-wrap gap-2">
              <Motion
                v-for="sport in sportChips"
                :key="sport"
                :while-press="{ scale: 0.96 }"
                :transition="{ type: 'spring', stiffness: 500, damping: 30 }"
              >
                <button
                  type="button"
                  class="rounded-full px-4 py-1.5 text-sm font-medium ring-1 transition-colors"
                  :class="state.sport === sport
                    ? 'bg-primary text-inverted ring-primary'
                    : 'bg-default text-muted ring-default hover:text-default hover:ring-inverted/20'"
                  @click="state.sport = sport"
                >
                  {{ t(`school.settings.sports.${sport}`) }}
                </button>
              </Motion>
            </div>
          </UFormField>

          <div class="grid gap-5 sm:grid-cols-2">
            <UFormField
              v-if="showSurface"
              :label="t('courts.form.surface')"
              name="surface"
            >
              <USelect
                v-model="state.surface"
                value-key="value"
                :items="surfaceOptions"
                :placeholder="t('courts.form.surfaceNone')"
                size="lg"
                class="w-full"
              />
            </UFormField>

            <UFormField
              :label="t('courts.form.environment')"
              name="environment"
            >
              <USelect
                v-model="state.environment"
                value-key="value"
                :items="environmentOptions"
                size="lg"
                class="w-full"
              />
            </UFormField>
          </div>

          <UFormField
            :label="t('courts.form.surfaceColor')"
            name="surfaceColor"
          >
            <div class="flex flex-wrap items-center gap-2">
              <button
                v-for="preset in COURT_COLOR_PRESETS"
                :key="preset"
                type="button"
                class="size-8 rounded-full ring-2 transition-transform"
                :style="{ backgroundColor: preset }"
                :class="state.surfaceColor.toLowerCase() === preset.toLowerCase()
                  ? 'ring-primary scale-110'
                  : 'ring-transparent hover:scale-105'"
                :aria-label="preset"
                @click="state.surfaceColor = preset"
              />
              <label
                class="relative flex size-8 cursor-pointer items-center justify-center overflow-hidden rounded-full ring-1 ring-default"
                :title="t('courts.form.customColor')"
              >
                <input
                  v-model="state.surfaceColor"
                  type="color"
                  class="absolute inset-0 cursor-pointer opacity-0"
                >
                <UIcon
                  name="i-lucide-pipette"
                  class="size-4 text-dimmed"
                />
              </label>
            </div>
          </UFormField>

          <UFormField
            :label="t('courts.form.lineColor')"
            name="lineColor"
          >
            <div class="flex items-center gap-2">
              <button
                v-for="preset in lineColorPresets"
                :key="preset"
                type="button"
                class="size-7 rounded-full ring-2 ring-offset-2 ring-offset-default transition-transform"
                :style="{ backgroundColor: preset }"
                :class="state.lineColor.toLowerCase() === preset.toLowerCase()
                  ? 'ring-primary scale-110'
                  : 'ring-default hover:scale-105'"
                :aria-label="preset"
                @click="state.lineColor = preset"
              />
            </div>
          </UFormField>

          <UFormField
            :label="t('courts.form.zone')"
            name="zoneId"
            :help="t('courts.form.zoneHelp')"
          >
            <USelectMenu
              v-model="state.zoneId"
              value-key="value"
              :items="zoneOptions"
              :search-input="{ placeholder: t('common.search') }"
              icon="i-lucide-layout-grid"
              size="lg"
              class="w-full"
            />
          </UFormField>

          <UFormField
            :label="t('courts.form.notes')"
            name="notes"
          >
            <UTextarea
              v-model="state.notes"
              :rows="2"
              autoresize
              size="lg"
              class="w-full"
              :placeholder="t('courts.form.notesPlaceholder')"
            />
          </UFormField>
        </UForm>
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
          :label="isEdit ? t('courts.form.save') : t('courts.form.create', { unit: unitLower })"
          @click="form?.submit()"
        />
      </div>
    </template>
  </USlideover>
</template>
