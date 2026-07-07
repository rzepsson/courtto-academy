<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui'
import { INVITABLE_ROLES } from '~~/shared/permissions'
import type { InvitableRole } from '~~/shared/permissions'

definePageMeta({ middleware: ['auth', 'school'], layout: 'dashboard' })

const { t, locale } = useI18n()
const toast = useToast()
const { copiedId, copy: copyInviteLink } = useInviteLink()
const { data: session } = await useAuthSession()

const membersFetch = useFetch('/api/school/members', { key: 'school:members' })
const invitationsFetch = useFetch('/api/school/invitations', { key: 'school:invitations' })
await Promise.all([membersFetch, invitationsFetch])

const { data: members, refresh: refreshMembers } = membersFetch
const { data: invitations, refresh: refreshInvitations } = invitationsFetch

const inviteOpen = ref(false)

type MemberRow = NonNullable<typeof members.value>[number]

function canManage(row: MemberRow) {
  return row.role !== 'owner' && row.user.id !== session.value?.user.id
}

async function changeRole(row: MemberRow, role: InvitableRole) {
  if (row.role === role) {
    return
  }

  const { error } = await authClient.organization.updateMemberRole({ memberId: row.id, role })

  if (error) {
    toast.add({ title: t('school.members.errors.updateFailed'), description: error.message, color: 'error' })
    return
  }

  await refreshMembers()
  toast.add({ title: t('school.members.roleUpdated', { name: row.user.name }), color: 'success' })
}

function memberActions(row: MemberRow): DropdownMenuItem[][] {
  return [
    [{
      label: t('school.members.changeRole'),
      icon: 'i-lucide-user-cog',
      children: INVITABLE_ROLES.map(role => ({
        label: t(`roles.${role}`),
        type: 'checkbox' as const,
        checked: row.role === role,
        onSelect: () => {
          changeRole(row, role)
        }
      }))
    }],
    [{
      label: t('school.members.remove'),
      icon: 'i-lucide-user-minus',
      color: 'error' as const,
      onSelect: () => {
        memberToRemove.value = row
      }
    }]
  ]
}

const memberToRemove = ref<MemberRow | null>(null)
const removing = ref(false)

async function confirmRemove() {
  if (!memberToRemove.value) {
    return
  }

  removing.value = true
  const { error } = await authClient.organization.removeMember({
    memberIdOrEmail: memberToRemove.value.id
  })
  removing.value = false

  if (error) {
    toast.add({ title: t('school.members.errors.removeFailed'), description: error.message, color: 'error' })
    return
  }

  toast.add({ title: t('school.members.removed', { name: memberToRemove.value.user.name }), color: 'success' })
  memberToRemove.value = null
  await refreshMembers()
}

async function cancelInvitation(invitationId: string) {
  const { error } = await authClient.organization.cancelInvitation({ invitationId })

  if (error) {
    toast.add({ title: t('school.invitations.errors.cancelFailed'), description: error.message, color: 'error' })
    return
  }

  toast.add({ title: t('school.invitations.canceled'), color: 'neutral' })
  await refreshInvitations()
}

function dateLabel(value: string) {
  return formatDate(value, locale.value)
}
</script>

<template>
  <UDashboardPanel id="school-members">
    <template #header>
      <UDashboardNavbar :title="t('nav.members')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <LocaleSwitcher />
          <ColorModeButton />
          <UButton
            icon="i-lucide-user-plus"
            :label="t('school.members.invite')"
            @click="inviteOpen = true"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-8">
        <UCard variant="subtle">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              {{ t('school.members.title') }}
            </h2>
            <p class="mt-1 text-sm text-muted">
              {{ t('school.members.subtitle') }}
            </p>
          </template>

          <ul class="flex flex-col divide-y divide-default">
            <li
              v-for="row in members ?? []"
              :key="row.id"
              class="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
            >
              <UUser
                :name="row.user.name"
                :description="row.user.email"
                :avatar="{ src: row.user.image ?? undefined, alt: row.user.name }"
                size="sm"
              />
              <div class="flex items-center gap-3">
                <span class="hidden text-xs text-dimmed sm:block">
                  {{ t('school.members.joined', { date: dateLabel(row.createdAt) }) }}
                </span>
                <RoleBadge :role="row.role" />
                <UDropdownMenu
                  v-if="canManage(row)"
                  :items="memberActions(row)"
                  :content="{ align: 'end' }"
                >
                  <UButton
                    color="neutral"
                    variant="ghost"
                    icon="i-lucide-ellipsis-vertical"
                    size="sm"
                    :aria-label="t('school.members.actions')"
                  />
                </UDropdownMenu>
                <span
                  v-else
                  class="size-8"
                />
              </div>
            </li>
          </ul>
        </UCard>

        <UCard variant="subtle">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              {{ t('school.invitations.title') }}
            </h2>
            <p class="mt-1 text-sm text-muted">
              {{ t('school.invitations.subtitle') }}
            </p>
          </template>

          <ul
            v-if="(invitations?.length ?? 0) > 0"
            class="flex flex-col divide-y divide-default"
          >
            <li
              v-for="invite in invitations ?? []"
              :key="invite.id"
              class="flex flex-wrap items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
            >
              <div class="min-w-0">
                <p class="truncate text-sm font-medium text-highlighted">
                  {{ invite.email }}
                </p>
                <p class="mt-0.5 text-xs text-dimmed">
                  {{ t('school.invitations.expires', { date: dateLabel(invite.expiresAt) }) }}
                </p>
              </div>
              <div class="flex items-center gap-2">
                <RoleBadge :role="invite.role" />
                <UButton
                  color="neutral"
                  variant="subtle"
                  size="sm"
                  :icon="copiedId === invite.id ? 'i-lucide-check' : 'i-lucide-copy'"
                  :label="copiedId === invite.id ? t('common.copied') : t('school.invitations.copyLink')"
                  @click="copyInviteLink(invite.id)"
                />
                <UButton
                  color="error"
                  variant="ghost"
                  size="sm"
                  icon="i-lucide-x"
                  :aria-label="t('school.invitations.cancel')"
                  @click="cancelInvitation(invite.id)"
                />
              </div>
            </li>
          </ul>

          <div
            v-else
            class="flex flex-col items-center py-6 text-center"
          >
            <div class="flex size-12 items-center justify-center rounded-full bg-elevated">
              <UIcon
                name="i-lucide-mail-plus"
                class="size-6 text-dimmed"
              />
            </div>
            <p class="mt-3 text-sm font-medium text-highlighted">
              {{ t('school.invitations.empty.title') }}
            </p>
            <p class="mt-1 max-w-sm text-sm text-muted">
              {{ t('school.invitations.empty.description') }}
            </p>
            <UButton
              class="mt-4"
              variant="subtle"
              icon="i-lucide-user-plus"
              :label="t('school.members.invite')"
              @click="inviteOpen = true"
            />
          </div>
        </UCard>
      </div>

      <SchoolInviteMemberModal
        v-model:open="inviteOpen"
        @created="refreshInvitations()"
      />

      <UModal
        :open="memberToRemove !== null"
        :title="t('school.members.removeConfirm.title')"
        :description="t('school.members.removeConfirm.description', { name: memberToRemove?.user.name })"
        @update:open="(value: boolean) => { if (!value) memberToRemove = null }"
      >
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :label="t('common.cancel')"
              @click="memberToRemove = null"
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
    </template>
  </UDashboardPanel>
</template>
