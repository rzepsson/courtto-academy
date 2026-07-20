<script setup lang="ts">
import type { ConsentState } from '~~/shared/member-consent'

// Consent decisions (RODO/GDPR). Shows one row per purpose — including the ones
// nobody has ever been asked about, because that gap is the actionable state.
const props = defineProps<{ memberId: string, dateOfBirth: string | null }>()

const { t, locale } = useI18n()
const toast = useToast()
const { toastError } = useApiError()

interface ConsentView {
  type: string
  state: ConsentState
  grantedAt: string | null
  withdrawnAt: string | null
  grantedByName: string | null
  guardianId: string | null
  documentVersion: string | null
  notes: string | null
  requiresGuardian: boolean
}

interface GuardianOption {
  id: string
  name: string
  relationship: string
}

const { data, status, refresh } = await useFetch<{ consents: ConsentView[] }>(
  () => `/api/school/members/${props.memberId}/consents`,
  { key: 'member-detail:consents' }
)
const consents = computed(() => data.value?.consents ?? [])
const loading = computed(() => status.value === 'pending')

// A minor's consent must come from one of their guardians, so the grant dialog
// needs the list (shared fetch key with the guardians card — one request).
const { data: guardianData } = await useFetch<{ guardians: GuardianOption[] }>(
  () => `/api/school/members/${props.memberId}/guardians`,
  { key: 'member-detail:guardians' }
)
const guardians = computed(() => guardianData.value?.guardians ?? [])

const STATE_COLOR: Record<ConsentState, 'success' | 'error' | 'neutral'> = {
  granted: 'success',
  withdrawn: 'error',
  unknown: 'neutral'
}

const STATE_ICON: Record<ConsentState, string> = {
  granted: 'i-lucide-check',
  withdrawn: 'i-lucide-x',
  unknown: 'i-lucide-circle-help'
}

// ── Grant dialog ────────────────────────────────────────────────────────────
const grantOpen = ref(false)
const granting = ref<ConsentView | null>(null)
const saving = ref(false)

const form = reactive({ guardianId: '', documentVersion: '', notes: '' })

// Only a minor needs a guardian giver; an adult consents for themselves.
const needsGuardian = computed(() => granting.value?.requiresGuardian ?? false)
const canSubmit = computed(() => !needsGuardian.value || form.guardianId !== '')

const guardianItems = computed(() =>
  guardians.value.map(guardian => ({
    value: guardian.id,
    label: `${guardian.name} · ${t(`school.members.guardians.relationships.${guardian.relationship}`)}`
  }))
)

function openGrant(consent: ConsentView) {
  granting.value = consent
  form.guardianId = consent.guardianId ?? guardians.value[0]?.id ?? ''
  form.documentVersion = consent.documentVersion ?? ''
  form.notes = consent.notes ?? ''
  grantOpen.value = true
}

async function submitGrant() {
  if (!granting.value) {
    return
  }
  saving.value = true
  try {
    await $fetch(`/api/school/members/${props.memberId}/consents/${granting.value.type}`, {
      method: 'PUT',
      body: {
        status: 'granted',
        guardianId: needsGuardian.value ? form.guardianId : null,
        documentVersion: form.documentVersion,
        notes: form.notes
      }
    })
    await refresh()
    grantOpen.value = false
    toast.add({ title: t('school.members.consents.saved'), color: 'success' })
  } catch (error) {
    toastError('school.members.consents.errors.saveFailed', error)
  } finally {
    saving.value = false
  }
}

// Withdrawal is one click and asks for nothing: art. 7(3) — as easy to withdraw as
// it was to give. Gating it behind a form would be a compliance bug, not a nicety.
const withdrawing = ref<string | null>(null)

async function withdraw(consent: ConsentView) {
  withdrawing.value = consent.type
  try {
    await $fetch(`/api/school/members/${props.memberId}/consents/${consent.type}`, {
      method: 'PUT',
      body: { status: 'withdrawn', documentVersion: consent.documentVersion ?? '', notes: consent.notes ?? '' }
    })
    await refresh()
    toast.add({ title: t('school.members.consents.withdrawn'), color: 'neutral' })
  } catch (error) {
    toastError('school.members.consents.errors.saveFailed', error)
  } finally {
    withdrawing.value = null
  }
}

function meta(consent: ConsentView): string | null {
  if (consent.state === 'granted' && consent.grantedAt) {
    const who = consent.grantedByName
    const when = formatDate(consent.grantedAt, locale.value)
    return who
      ? t('school.members.consents.grantedMeta', { who, when })
      : t('school.members.consents.grantedMetaNoName', { when })
  }
  if (consent.state === 'withdrawn' && consent.withdrawnAt) {
    return t('school.members.consents.withdrawnMeta', { when: formatDate(consent.withdrawnAt, locale.value) })
  }
  return null
}
</script>

<template>
  <UCard variant="subtle">
    <template #header>
      <h2 class="font-semibold text-highlighted">
        {{ t('school.members.consents.title') }}
      </h2>
      <p class="mt-1 text-sm text-muted">
        {{ t('school.members.consents.subtitle') }}
      </p>
    </template>

    <AppListSkeleton
      v-if="loading"
      :rows="2"
    />

    <ul
      v-else
      class="flex flex-col divide-y divide-default/60"
    >
      <li
        v-for="consent in consents"
        :key="consent.type"
        class="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0"
      >
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-1.5">
            <p class="text-sm font-medium text-highlighted">
              {{ t(`school.members.consents.types.${consent.type}`) }}
            </p>
            <UBadge
              :label="t(`school.members.consents.states.${consent.state}`)"
              :color="STATE_COLOR[consent.state]"
              :icon="STATE_ICON[consent.state]"
              variant="subtle"
              size="sm"
            />
          </div>
          <p class="mt-0.5 text-xs text-muted">
            {{ t(`school.members.consents.purposes.${consent.type}`) }}
          </p>
          <p
            v-if="meta(consent)"
            class="mt-1 text-xs text-dimmed"
          >
            {{ meta(consent) }}
            <template v-if="consent.documentVersion">
              · {{ consent.documentVersion }}
            </template>
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <UButton
            v-if="consent.state !== 'granted'"
            color="neutral"
            variant="subtle"
            size="xs"
            icon="i-lucide-check"
            :label="t('school.members.consents.grant')"
            @click="openGrant(consent)"
          />
          <UButton
            v-else
            color="neutral"
            variant="ghost"
            size="xs"
            icon="i-lucide-undo-2"
            :label="t('school.members.consents.withdraw')"
            :loading="withdrawing === consent.type"
            @click="withdraw(consent)"
          />
        </div>
      </li>
    </ul>

    <UModal
      :open="grantOpen"
      :title="t('school.members.consents.grantTitle')"
      :description="granting ? t(`school.members.consents.purposes.${granting.type}`) : ''"
      @update:open="(value: boolean) => { if (!value) grantOpen = false }"
    >
      <template #body>
        <div class="flex flex-col gap-4">
          <UFormField
            v-if="needsGuardian"
            :label="t('school.members.consents.givenBy')"
            :hint="t('school.members.consents.givenByHint')"
          >
            <USelect
              v-if="guardianItems.length"
              v-model="form.guardianId"
              value-key="value"
              :items="guardianItems"
              class="w-full"
            />
            <UAlert
              v-else
              color="warning"
              variant="subtle"
              icon="i-lucide-triangle-alert"
              :description="t('school.members.consents.noGuardian')"
            />
          </UFormField>

          <UFormField
            :label="t('school.members.consents.documentVersion')"
            :hint="t('school.members.consents.documentVersionHint')"
          >
            <UInput
              v-model="form.documentVersion"
              class="w-full"
            />
          </UFormField>

          <UFormField :label="t('school.members.consents.notes')">
            <UTextarea
              v-model="form.notes"
              :rows="2"
              class="w-full"
            />
          </UFormField>

          <div class="flex justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :label="t('common.cancel')"
              @click="grantOpen = false"
            />
            <PressButton
              :block="false"
              icon="i-lucide-check"
              :label="t('school.members.consents.grant')"
              :loading="saving"
              :disabled="!canSubmit"
              @click="submitGrant"
            />
          </div>
        </div>
      </template>
    </UModal>
  </UCard>
</template>
