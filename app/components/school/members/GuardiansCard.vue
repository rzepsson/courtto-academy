<script setup lang="ts">
import { GUARDIAN_LIMITS, GUARDIAN_RELATIONSHIPS, isGuardianRelationship, needsGuardian } from '~~/shared/member-guardian'
import type { GuardianRelationship } from '~~/shared/member-guardian'
import type { GuardianErrorCode } from '~~/shared/member-guardian-schema'
import { guardianCreateSchema } from '~~/shared/member-guardian-schema'

// Who the school calls about this member. Self-contained CRUD; the cockpit passes
// the member's date of birth so the "minor with nobody to call" gap can be derived
// here rather than stored anywhere.
const props = defineProps<{ memberId: string, dateOfBirth: string | null }>()

const { t } = useI18n()
const toast = useToast()
const { toastError } = useApiError()

interface GuardianView {
  id: string
  name: string
  relationship: string
  phone: string | null
  email: string | null
  isPrimary: boolean
  notes: string | null
  createdAt: string
}

const { data, status, refresh } = await useFetch<{ guardians: GuardianView[] }>(
  () => `/api/school/members/${props.memberId}/guardians`,
  { key: 'member-detail:guardians' }
)
const guardians = computed(() => data.value?.guardians ?? [])
const loading = computed(() => status.value === 'pending')

// Derived, never stored — a flag would drift the moment a birthday passes.
const gapOpen = computed(() => needsGuardian(props.dateOfBirth, guardians.value.length))
const atLimit = computed(() => guardians.value.length >= GUARDIAN_LIMITS.perMember)

const relationshipItems = computed(() =>
  GUARDIAN_RELATIONSHIPS.map(value => ({ value, label: t(`school.members.guardians.relationships.${value}`) }))
)

// ── Add / edit form ─────────────────────────────────────────────────────────
const formOpen = ref(false)
const editing = ref<GuardianView | null>(null)
const saving = ref(false)

const form = reactive({
  name: '',
  relationship: 'mother' as GuardianRelationship,
  phone: '',
  email: '',
  isPrimary: false,
  notes: ''
})

// A stored value we don't recognise (an older deploy, a hand-edited row) degrades
// to `other` rather than breaking the picker.
function toRelationship(value: string): GuardianRelationship {
  return isGuardianRelationship(value) ? value : 'other'
}

const resolveError = (code: GuardianErrorCode) => t(`school.members.guardians.errors.${code}`)
const formSchema = computed(() => guardianCreateSchema(resolveError))

function openAdd() {
  editing.value = null
  Object.assign(form, {
    name: '',
    relationship: 'mother',
    phone: '',
    email: '',
    // The first contact is the primary one by definition (the server enforces it
    // too) — reflect that in the form rather than letting it look optional.
    isPrimary: guardians.value.length === 0,
    notes: ''
  })
  formOpen.value = true
}

function openEdit(guardian: GuardianView) {
  editing.value = guardian
  Object.assign(form, {
    name: guardian.name,
    relationship: toRelationship(guardian.relationship),
    phone: guardian.phone ?? '',
    email: guardian.email ?? '',
    isPrimary: guardian.isPrimary,
    notes: guardian.notes ?? ''
  })
  formOpen.value = true
}

async function submit() {
  saving.value = true
  const body = { ...form }
  try {
    if (editing.value) {
      await $fetch(`/api/school/members/${props.memberId}/guardians/${editing.value.id}`, { method: 'PATCH', body })
    } else {
      await $fetch(`/api/school/members/${props.memberId}/guardians`, { method: 'POST', body })
    }
    await refresh()
    formOpen.value = false
    toast.add({ title: t('school.members.guardians.saved'), color: 'success' })
  } catch (error) {
    toastError('school.members.guardians.errors.saveFailed', error)
  } finally {
    saving.value = false
  }
}

async function makePrimary(guardian: GuardianView) {
  try {
    await $fetch(`/api/school/members/${props.memberId}/guardians/${guardian.id}`, {
      method: 'PATCH',
      body: { isPrimary: true }
    })
    await refresh()
  } catch (error) {
    toastError('school.members.guardians.errors.saveFailed', error)
  }
}

// ── Delete ──────────────────────────────────────────────────────────────────
const toRemove = ref<GuardianView | null>(null)
const removing = ref(false)

async function confirmRemove() {
  if (!toRemove.value) {
    return
  }
  removing.value = true
  try {
    await $fetch(`/api/school/members/${props.memberId}/guardians/${toRemove.value.id}` as string, { method: 'DELETE' })
    toRemove.value = null
    await refresh()
  } catch (error) {
    toastError('school.members.guardians.errors.removeFailed', error)
  } finally {
    removing.value = false
  }
}

function channels(guardian: GuardianView): string {
  return [guardian.phone, guardian.email].filter(Boolean).join(' · ')
}
</script>

<template>
  <UCard variant="subtle">
    <template #header>
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="font-semibold text-highlighted">
            {{ t('school.members.guardians.title') }}
          </h2>
          <p class="mt-1 text-sm text-muted">
            {{ t('school.members.guardians.subtitle') }}
          </p>
        </div>
        <UButton
          color="neutral"
          variant="subtle"
          size="sm"
          icon="i-lucide-user-plus"
          :label="t('school.members.guardians.add')"
          :disabled="atLimit"
          @click="openAdd"
        />
      </div>
    </template>

    <!-- The gap this whole model exists to close: a child on the roster with
         nobody to call. Surfaced, never enforced as a block. -->
    <UAlert
      v-if="gapOpen"
      color="warning"
      variant="subtle"
      icon="i-lucide-triangle-alert"
      :title="t('school.members.guardians.gap.title')"
      :description="t('school.members.guardians.gap.description')"
      class="mb-4"
    />

    <AppListSkeleton
      v-if="loading"
      :rows="2"
    />

    <p
      v-else-if="guardians.length === 0"
      class="py-6 text-center text-sm text-muted"
    >
      {{ t('school.members.guardians.empty') }}
    </p>

    <ul
      v-else
      class="flex flex-col divide-y divide-default/60"
    >
      <li
        v-for="guardian in guardians"
        :key="guardian.id"
        class="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
      >
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-1.5">
            <p class="truncate text-sm font-medium text-highlighted">
              {{ guardian.name }}
            </p>
            <UBadge
              v-if="guardian.isPrimary"
              :label="t('school.members.guardians.primary')"
              color="primary"
              variant="subtle"
              size="sm"
            />
            <UBadge
              :label="t(`school.members.guardians.relationships.${guardian.relationship}`)"
              color="neutral"
              variant="subtle"
              size="sm"
            />
          </div>
          <p class="mt-0.5 truncate text-xs text-muted">
            {{ channels(guardian) }}
          </p>
          <p
            v-if="guardian.notes"
            class="mt-1 text-xs text-dimmed"
          >
            {{ guardian.notes }}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <UButton
            v-if="!guardian.isPrimary"
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-star"
            :aria-label="t('school.members.guardians.makePrimary')"
            :title="t('school.members.guardians.makePrimary')"
            @click="makePrimary(guardian)"
          />
          <UButton
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-pencil"
            :aria-label="t('common.edit')"
            @click="openEdit(guardian)"
          />
          <UButton
            color="error"
            variant="ghost"
            size="xs"
            icon="i-lucide-trash-2"
            :aria-label="t('school.members.guardians.remove')"
            @click="toRemove = guardian"
          />
        </div>
      </li>
    </ul>

    <UModal
      :open="formOpen"
      :title="editing ? t('school.members.guardians.editTitle') : t('school.members.guardians.addTitle')"
      :description="t('school.members.guardians.formHint')"
      @update:open="(value: boolean) => { if (!value) formOpen = false }"
    >
      <template #body>
        <UForm
          :schema="formSchema"
          :state="form"
          class="flex flex-col gap-4"
          @submit="submit"
        >
          <UFormField
            name="name"
            :label="t('school.members.guardians.fields.name')"
          >
            <UInput
              v-model="form.name"
              class="w-full"
            />
          </UFormField>

          <UFormField
            name="relationship"
            :label="t('school.members.guardians.fields.relationship')"
          >
            <USelect
              v-model="form.relationship"
              value-key="value"
              :items="relationshipItems"
              class="w-full"
            />
          </UFormField>

          <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <UFormField
              name="phone"
              :label="t('school.members.guardians.fields.phone')"
            >
              <UInput
                v-model="form.phone"
                type="tel"
                class="w-full"
              />
            </UFormField>
            <UFormField
              name="email"
              :label="t('school.members.guardians.fields.email')"
            >
              <UInput
                v-model="form.email"
                type="email"
                class="w-full"
              />
            </UFormField>
          </div>

          <UFormField
            name="notes"
            :label="t('school.members.guardians.fields.notes')"
          >
            <UTextarea
              v-model="form.notes"
              :rows="2"
              class="w-full"
            />
          </UFormField>

          <UFormField name="isPrimary">
            <USwitch
              v-model="form.isPrimary"
              :label="t('school.members.guardians.fields.isPrimary')"
              :description="t('school.members.guardians.fields.isPrimaryHint')"
            />
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :label="t('common.cancel')"
              @click="formOpen = false"
            />
            <PressButton
              type="submit"
              :block="false"
              icon="i-lucide-check"
              :label="t('common.save')"
              :loading="saving"
            />
          </div>
        </UForm>
      </template>
    </UModal>

    <UModal
      :open="toRemove !== null"
      :title="t('school.members.guardians.removeConfirm.title')"
      :description="t('school.members.guardians.removeConfirm.description', { name: toRemove?.name })"
      @update:open="(value: boolean) => { if (!value) toRemove = null }"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :label="t('common.cancel')"
            @click="toRemove = null"
          />
          <UButton
            color="error"
            :loading="removing"
            :label="t('school.members.guardians.remove')"
            @click="confirmRemove"
          />
        </div>
      </template>
    </UModal>
  </UCard>
</template>
