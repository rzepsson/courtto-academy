<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { INVITABLE_ROLES } from '~~/shared/permissions'
import type { InvitableRole, OrgRole } from '~~/shared/permissions'
import { MEMBER_PROFILE_LIMITS } from '~~/shared/member-profile'
import type { MemberProfileErrorCode } from '~~/shared/member-profile-schema'
import { memberProfileSchema } from '~~/shared/member-profile-schema'
import type { MemberStatus } from '~~/shared/member-profile'
import { calculateAge, isMinor } from '~~/shared/member-guardian'

// Per-member cockpit, in tabs (mirroring the courts cockpit):
//   Overview — identity + access/lifecycle governance + staff CRM (notes/tags) +
//              the audit trail. Core: true of any member of any org.
//   Academy  — what this person actually does here: hours taught or trained, and
//              in which groups. The Academy layer, built on top of the core.
// Both panels stay mounted (v-show) so switching keeps their state and refetches
// nothing.
definePageMeta({ middleware: ['auth', 'school'], layout: 'dashboard' })

const route = useRoute()
const { t, locale } = useI18n()
const toast = useToast()
const { toastError } = useApiError()
const { data: session } = await useAuthSession()

const memberId = computed(() => route.params.id as string)

interface MemberDetailView {
  id: string
  role: OrgRole
  createdAt: string
  status: MemberStatus
  canCoach: boolean
  dateOfBirth: string | null
  notes: string | null
  tags: string[]
  user: { id: string, name: string, email: string, image: string | null }
}

// A dynamic URL matches several typed routes (the static directory/export siblings),
// so the response type is annotated explicitly rather than inferred as a union.
const { data, status, error, refresh } = await useFetch<{ member: MemberDetailView }>(
  () => `/api/school/members/${memberId.value}`,
  { key: 'member-detail' }
)
const member = computed(() => data.value?.member ?? null)
const notFound = computed(() =>
  (error.value?.statusCode === 404) || (status.value === 'success' && !member.value)
)

interface AuditEntryView {
  id: string
  action: string
  actorMemberId: string | null
  data: Record<string, string | number | null> | null
  createdAt: string
}

const { data: auditData, refresh: refreshAudit } = await useFetch<{ entries: AuditEntryView[] }>(
  () => `/api/school/members/${memberId.value}/audit`,
  { key: 'member-audit' }
)
const auditEntries = computed(() => auditData.value?.entries ?? [])

// The school's zone drives the Academy panel's rolling window (shared fetch key
// with the courts cockpit, so it's one request across the app).
const { data: profileData } = await useFetch('/api/school/profile', { key: 'school-profile' })
const timezone = computed(() => profileData.value?.profile.timezone ?? 'Europe/Warsaw')

// Cockpit tabs: identity/access/CRM vs what the person actually does here. Both
// panels stay mounted (v-show), so the Academy period selector survives switching
// and nothing refetches on tab change (mirrors the courts cockpit).
type CockpitTab = 'overview' | 'academy'
const activeTab = ref<CockpitTab>('overview')
const tabs: { key: CockpitTab, label: string, icon: string }[] = [
  { key: 'overview', label: 'school.members.profile.tabs.overview', icon: 'i-lucide-id-card' },
  { key: 'academy', label: 'school.members.profile.tabs.academy', icon: 'i-lucide-graduation-cap' }
]

// The viewer's own role in this school — ownership transfer is owner-only, which a
// school-area guard alone wouldn't express (an admin must never hand it off).
const { data: appContext } = await useAppContext()
const viewerRole = computed(() => activeMembershipOf(appContext.value)?.role ?? null)

const isSelf = computed(() => member.value?.user.id === session.value?.user.id)
const isOwner = computed(() => member.value?.role === 'owner')
// Role + lifecycle are locked for the owner (protected) and for yourself (no
// self-demotion / self-suspension). The coaching capability is NOT locked — an
// owner/admin marking themselves able to teach is legitimate.
const governanceLocked = computed(() => isOwner.value || isSelf.value)
const showCoachToggle = computed(() => member.value?.role === 'owner' || member.value?.role === 'admin')

function dateLabel(value: string) {
  return formatDate(value, locale.value)
}

const STATUS_COLOR: Record<MemberStatus, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  suspended: 'warning',
  archived: 'neutral'
}

// ── Mutations ──────────────────────────────────────────────────────────────
const saving = ref(false)

async function saveProfile(patch: Record<string, unknown>): Promise<boolean> {
  saving.value = true
  try {
    await $fetch(`/api/school/members/${memberId.value}/profile`, { method: 'PATCH', body: patch })
    await Promise.all([refresh(), refreshAudit()])
    return true
  } catch (err) {
    toastError('school.members.profile.errors.saveFailed', err)
    return false
  } finally {
    saving.value = false
  }
}

async function changeRole(role: InvitableRole) {
  if (!member.value || member.value.role === role) {
    return
  }
  const name = member.value.user.name
  try {
    await $fetch(`/api/school/members/${memberId.value}/role`, { method: 'PATCH', body: { role } })
    await Promise.all([refresh(), refreshAudit()])
    toast.add({ title: t('school.members.roleUpdated', { name }), color: 'success' })
  } catch (err) {
    toastError('school.members.errors.updateFailed', err)
  }
}

const roleMenuItems = computed<DropdownMenuItem[]>(() =>
  INVITABLE_ROLES.map(role => ({
    label: t(`roles.${role}`),
    type: 'checkbox' as const,
    checked: member.value?.role === role,
    onSelect: () => { changeRole(role) }
  }))
)

async function setStatus(next: MemberStatus) {
  if (await saveProfile({ status: next })) {
    toast.add({ title: t('school.members.profile.details.saved'), color: 'success' })
  }
}

async function toggleCoach(value: boolean) {
  if (await saveProfile({ canCoach: value })) {
    toast.add({ title: t('school.members.profile.details.saved'), color: 'success' })
  }
}

const lifecycleActions = computed<{ label: string, next: MemberStatus, icon: string, color: 'primary' | 'warning' | 'neutral' }[]>(() => {
  switch (member.value?.status) {
    case 'active':
      return [
        { label: t('school.members.profile.access.suspend'), next: 'suspended', icon: 'i-lucide-pause', color: 'warning' },
        { label: t('school.members.profile.access.archive'), next: 'archived', icon: 'i-lucide-archive', color: 'neutral' }
      ]
    case 'suspended':
      return [
        { label: t('school.members.profile.access.reactivate'), next: 'active', icon: 'i-lucide-play', color: 'primary' },
        { label: t('school.members.profile.access.archive'), next: 'archived', icon: 'i-lucide-archive', color: 'neutral' }
      ]
    case 'archived':
      return [
        { label: t('school.members.profile.access.restore'), next: 'active', icon: 'i-lucide-rotate-ccw', color: 'primary' }
      ]
    default:
      return []
  }
})

// ── Personal details (dirty-tracked, validated card) ────────────────────────
// The age badge is derived from the stored date on every render — never a stored
// flag, which would go stale the day a birthday passes.
const minor = computed(() => isMinor(member.value?.dateOfBirth))
const age = computed(() => (member.value?.dateOfBirth ? calculateAge(member.value.dateOfBirth) : null))

const details = reactive<{ dateOfBirth: string, notes: string, tags: string[] }>({
  dateOfBirth: '',
  notes: '',
  tags: []
})
watch(member, (m) => {
  if (m) {
    details.dateOfBirth = m.dateOfBirth ?? ''
    details.notes = m.notes ?? ''
    details.tags = [...m.tags]
  }
}, { immediate: true })

const detailsDirty = computed(() => {
  if (!member.value) {
    return false
  }
  const dobChanged = details.dateOfBirth !== (member.value.dateOfBirth ?? '')
  const notesChanged = details.notes.trim() !== (member.value.notes ?? '')
  const stored = member.value.tags
  const tagsChanged = details.tags.length !== stored.length || details.tags.some((tag, i) => tag !== stored[i])
  return dobChanged || notesChanged || tagsChanged
})

const resolveError = (code: MemberProfileErrorCode) => t(`school.members.profile.errors.${code}`)
const detailsSchema = computed(() =>
  memberProfileSchema(resolveError).pick({ dateOfBirth: true, notes: true, tags: true })
)

async function saveDetails() {
  const saved = await saveProfile({
    dateOfBirth: details.dateOfBirth,
    notes: details.notes,
    tags: details.tags
  })
  if (saved) {
    toast.add({ title: t('school.members.profile.details.saved'), color: 'success' })
  }
}

// ── Ownership transfer (owner-only, sensitive) ──────────────────────────────
// Only the current owner may hand the school over, and only to an active member
// who isn't already the owner (and never to themselves) — mirrors the server.
const canTransferOwnership = computed(() =>
  viewerRole.value === 'owner'
  && !!member.value
  && !isSelf.value
  && member.value.role !== 'owner'
  && member.value.status === 'active'
)

const transferOpen = ref(false)
const transferring = ref(false)

async function confirmTransfer() {
  if (!member.value) {
    return
  }
  const name = member.value.user.name
  transferring.value = true
  try {
    await $fetch(`/api/school/members/${memberId.value}/owner`, { method: 'POST' })
    // The viewer just became an admin — app-context drives the nav and the area
    // guards, so it has to be refreshed alongside the member and the trail.
    await Promise.all([refresh(), refreshAudit(), refreshAppContext()])
    transferOpen.value = false
    toast.add({ title: t('school.members.profile.access.transferred', { name }), color: 'success' })
  } catch (err) {
    toastError('school.members.profile.errors.transferFailed', err)
  } finally {
    transferring.value = false
  }
}

// ── Remove (hard, destructive) ──────────────────────────────────────────────
const removeOpen = ref(false)
const removing = ref(false)

const headerMenu = computed<DropdownMenuItem[][]>(() => {
  const groups: DropdownMenuItem[][] = []
  if (canTransferOwnership.value) {
    groups.push([{
      label: t('school.members.profile.access.transferOwnership'),
      icon: 'i-lucide-crown',
      onSelect: () => { transferOpen.value = true }
    }])
  }
  if (!governanceLocked.value) {
    groups.push([{
      label: t('school.members.remove'),
      icon: 'i-lucide-user-minus',
      color: 'error' as const,
      onSelect: () => { removeOpen.value = true }
    }])
  }
  return groups
})

async function confirmRemove() {
  if (!member.value) {
    return
  }
  const name = member.value.user.name
  removing.value = true
  try {
    await $fetch(`/api/school/members/${memberId.value}` as string, { method: 'DELETE' })
    toast.add({ title: t('school.members.removed', { name }), color: 'neutral' })
    await navigateTo('/school/members')
  } catch (err) {
    toastError('school.members.errors.removeFailed', err)
  } finally {
    removing.value = false
  }
}

// ── Activity timeline (audit) ───────────────────────────────────────────────
// Rendering lives in `app/utils/audit.ts`, shared with the org-wide Activity log.
function relativeTime(value: string): string {
  return formatRelativeTime(value, locale.value)
}
</script>

<template>
  <UDashboardPanel id="school-member-detail">
    <template #header>
      <UDashboardNavbar :title="member?.user.name ?? t('school.members.profile.identity.title')">
        <template #leading>
          <UButton
            icon="i-lucide-arrow-left"
            color="neutral"
            variant="ghost"
            :aria-label="t('school.members.profile.back')"
            to="/school/members"
          />
        </template>
        <template #right>
          <AppHeaderControls />
          <UDropdownMenu
            v-if="member && headerMenu.length > 0"
            :items="headerMenu"
            :content="{ align: 'end' }"
          >
            <UButton
              color="neutral"
              variant="ghost"
              icon="i-lucide-ellipsis-vertical"
              :aria-label="t('school.members.actions')"
            />
          </UDropdownMenu>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div
        v-if="notFound"
        class="flex flex-col items-center py-16 text-center"
      >
        <div class="flex size-14 items-center justify-center rounded-full bg-elevated">
          <UIcon
            name="i-lucide-user-x"
            class="size-7 text-dimmed"
          />
        </div>
        <p class="mt-4 text-base font-medium text-highlighted">
          {{ t('school.members.profile.notFound.title') }}
        </p>
        <p class="mt-1 max-w-sm text-sm text-muted">
          {{ t('school.members.profile.notFound.description') }}
        </p>
        <UButton
          class="mt-5"
          color="neutral"
          variant="subtle"
          icon="i-lucide-arrow-left"
          :label="t('school.members.profile.notFound.back')"
          to="/school/members"
        />
      </div>

      <div
        v-else-if="member"
        class="flex flex-col gap-6"
      >
        <!-- Tabs -->
        <div class="-mb-1 flex gap-1 overflow-x-auto border-b border-default">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            class="-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus-visible:text-primary"
            :class="activeTab === tab.key ? 'border-primary text-primary' : 'border-transparent text-muted hover:text-default'"
            @click="activeTab = tab.key"
          >
            <UIcon
              :name="tab.icon"
              class="size-4"
            />
            {{ t(tab.label) }}
          </button>
        </div>

        <!-- Academy tab: what this person actually does in the school. -->
        <div v-show="activeTab === 'academy'">
          <MotionReveal>
            <SchoolMembersAcademyPanel
              :member-id="memberId"
              :timezone="timezone"
            />
          </MotionReveal>
        </div>

        <div
          v-show="activeTab === 'overview'"
          class="grid grid-cols-1 items-start gap-6 lg:grid-cols-2"
        >
          <!-- Left: identity + access/lifecycle -->
          <div class="flex flex-col gap-6">
            <MotionReveal>
              <UCard variant="subtle">
                <div class="flex items-center gap-4">
                  <UAvatar
                    :src="member.user.image ?? undefined"
                    :alt="member.user.name"
                    size="xl"
                    class="shrink-0 ring-1 ring-default"
                  />
                  <div class="min-w-0">
                    <div class="flex items-center gap-2">
                      <h2 class="truncate text-lg font-semibold text-highlighted">
                        {{ member.user.name }}
                      </h2>
                      <UBadge
                        v-if="isSelf"
                        :label="t('school.members.you')"
                        color="neutral"
                        variant="subtle"
                        size="sm"
                      />
                    </div>
                    <p class="truncate text-sm text-muted">
                      {{ member.user.email }}
                    </p>
                    <div class="mt-2 flex flex-wrap items-center gap-2">
                      <RoleBadge :role="member.role" />
                      <UBadge
                        :label="t(`school.members.directory.statusLabels.${member.status}`)"
                        :color="STATUS_COLOR[member.status]"
                        variant="subtle"
                        size="sm"
                      />
                      <UBadge
                        v-if="minor"
                        :label="t('school.members.guardians.minor', { age })"
                        color="info"
                        variant="subtle"
                        size="sm"
                        icon="i-lucide-baby"
                      />
                    </div>
                  </div>
                </div>
                <template #footer>
                  <p class="text-xs text-dimmed">
                    {{ t('school.members.profile.identity.joined', { date: dateLabel(member.createdAt) }) }}
                  </p>
                </template>
              </UCard>
            </MotionReveal>

            <MotionReveal :delay="0.05">
              <UCard variant="subtle">
                <template #header>
                  <h2 class="font-semibold text-highlighted">
                    {{ t('school.members.profile.access.title') }}
                  </h2>
                </template>

                <div class="flex flex-col divide-y divide-default/60">
                  <!-- Role -->
                  <div class="flex items-center justify-between gap-4 pb-4">
                    <div>
                      <p class="text-sm font-medium text-highlighted">
                        {{ t('school.members.profile.access.roleLabel') }}
                      </p>
                    </div>
                    <UDropdownMenu
                      v-if="!governanceLocked"
                      :items="[roleMenuItems]"
                      :content="{ align: 'end' }"
                    >
                      <UButton
                        color="neutral"
                        variant="subtle"
                        size="sm"
                        trailing-icon="i-lucide-chevron-down"
                      >
                        <RoleBadge :role="member.role" />
                      </UButton>
                    </UDropdownMenu>
                    <RoleBadge
                      v-else
                      :role="member.role"
                    />
                  </div>

                  <!-- Coaching capability -->
                  <div
                    v-if="showCoachToggle"
                    class="flex items-start justify-between gap-4 py-4"
                  >
                    <div class="min-w-0">
                      <p class="text-sm font-medium text-highlighted">
                        {{ t('school.members.profile.access.canCoach') }}
                      </p>
                      <p class="mt-0.5 text-xs text-muted">
                        {{ t('school.members.profile.access.canCoachHint') }}
                      </p>
                    </div>
                    <USwitch
                      :model-value="member.canCoach"
                      :disabled="saving"
                      class="shrink-0"
                      @update:model-value="toggleCoach"
                    />
                  </div>

                  <!-- Lifecycle -->
                  <div class="flex items-start justify-between gap-4 pt-4">
                    <div class="min-w-0">
                      <p class="text-sm font-medium text-highlighted">
                        {{ t('school.members.profile.access.lifecycleTitle') }}
                      </p>
                      <p class="mt-0.5 text-xs text-muted">
                        {{ member.status === 'active'
                          ? t('school.members.profile.access.suspendHint')
                          : t('school.members.profile.access.archiveHint') }}
                      </p>
                    </div>
                    <div
                      v-if="governanceLocked"
                      class="shrink-0"
                    >
                      <p class="text-xs text-dimmed">
                        {{ isOwner
                          ? t('school.members.profile.access.ownerProtected')
                          : t('school.members.profile.access.selfHint') }}
                      </p>
                    </div>
                    <div
                      v-else
                      class="flex shrink-0 flex-wrap justify-end gap-2"
                    >
                      <UButton
                        v-for="action in lifecycleActions"
                        :key="action.next"
                        :color="action.color"
                        variant="subtle"
                        size="sm"
                        :icon="action.icon"
                        :label="action.label"
                        :loading="saving"
                        @click="setStatus(action.next)"
                      />
                    </div>
                  </div>
                </div>
              </UCard>
            </MotionReveal>

            <MotionReveal :delay="0.08">
              <SchoolMembersGuardiansCard
                :member-id="memberId"
                :date-of-birth="member.dateOfBirth"
              />
            </MotionReveal>

            <MotionReveal :delay="0.12">
              <SchoolMembersConsentsCard
                :member-id="memberId"
                :date-of-birth="member.dateOfBirth"
              />
            </MotionReveal>
          </div>

          <!-- Right: staff notes + tags + activity -->
          <div class="flex flex-col gap-6">
            <MotionReveal :delay="0.1">
              <UCard variant="subtle">
                <template #header>
                  <h2 class="font-semibold text-highlighted">
                    {{ t('school.members.profile.details.title') }}
                  </h2>
                </template>

                <UForm
                  :schema="detailsSchema"
                  :state="details"
                  class="flex flex-col gap-5"
                  @submit="saveDetails"
                >
                  <UFormField
                    name="dateOfBirth"
                    :label="t('school.members.profile.details.dobLabel')"
                    :hint="t('school.members.profile.details.dobHint')"
                  >
                    <UInput
                      v-model="details.dateOfBirth"
                      type="date"
                      class="w-full"
                    />
                  </UFormField>

                  <UFormField
                    name="notes"
                    :label="t('school.members.profile.details.notesLabel')"
                    :hint="t('school.members.profile.details.notesHint')"
                  >
                    <UTextarea
                      v-model="details.notes"
                      :rows="5"
                      autoresize
                      :maxrows="12"
                      :placeholder="t('school.members.profile.details.notesPlaceholder')"
                      class="w-full"
                    />
                  </UFormField>

                  <UFormField
                    name="tags"
                    :label="t('school.members.profile.details.tagsLabel')"
                  >
                    <UInputTags
                      v-model="details.tags"
                      :max="MEMBER_PROFILE_LIMITS.tags"
                      :placeholder="t('school.members.profile.details.tagsPlaceholder')"
                      class="w-full"
                    />
                  </UFormField>

                  <div class="flex justify-end">
                    <PressButton
                      type="submit"
                      :block="false"
                      icon="i-lucide-check"
                      :label="t('school.members.profile.details.save')"
                      :loading="saving"
                      :disabled="!detailsDirty"
                    />
                  </div>
                </UForm>
              </UCard>
            </MotionReveal>

            <MotionReveal :delay="0.15">
              <UCard variant="subtle">
                <template #header>
                  <h2 class="font-semibold text-highlighted">
                    {{ t('school.members.profile.activity.title') }}
                  </h2>
                </template>

                <p
                  v-if="auditEntries.length === 0"
                  class="py-4 text-center text-sm text-muted"
                >
                  {{ t('audit.none') }}
                </p>
                <ol
                  v-else
                  class="flex flex-col gap-4"
                >
                  <li
                    v-for="entry in auditEntries"
                    :key="entry.id"
                    class="flex gap-3"
                  >
                    <div class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-elevated ring-1 ring-default">
                      <UIcon
                        :name="auditActionIcon(entry.action)"
                        class="size-4 text-dimmed"
                      />
                    </div>
                    <div class="min-w-0">
                      <p class="text-sm text-highlighted">
                        {{ auditActionText(entry, t) }}
                      </p>
                      <p class="mt-0.5 text-xs text-dimmed">
                        <template v-if="entry.data?.actorName">
                          {{ t('audit.by', { actor: entry.data.actorName }) }} ·
                        </template>
                        {{ relativeTime(entry.createdAt) }}
                      </p>
                    </div>
                  </li>
                </ol>
              </UCard>
            </MotionReveal>
          </div>
        </div>
      </div>
    </template>

    <UModal
      :open="transferOpen"
      :title="t('school.members.profile.access.transferConfirm.title')"
      :description="t('school.members.profile.access.transferConfirm.description', { name: member?.user.name })"
      @update:open="(value: boolean) => { if (!value) transferOpen = false }"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :label="t('common.cancel')"
            @click="transferOpen = false"
          />
          <UButton
            color="warning"
            icon="i-lucide-crown"
            :loading="transferring"
            :label="t('school.members.profile.access.transferOwnership')"
            @click="confirmTransfer"
          />
        </div>
      </template>
    </UModal>

    <UModal
      :open="removeOpen"
      :title="t('school.members.removeConfirm.title')"
      :description="t('school.members.removeConfirm.description', { name: member?.user.name })"
      @update:open="(value: boolean) => { if (!value) removeOpen = false }"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton
            color="neutral"
            variant="ghost"
            :label="t('common.cancel')"
            @click="removeOpen = false"
          />
          <UButton
            color="error"
            :loading="removing"
            :label="t('school.members.remove')"
            @click="confirmRemove"
          />
        </div>
      </template>
    </UModal>
  </UDashboardPanel>
</template>
