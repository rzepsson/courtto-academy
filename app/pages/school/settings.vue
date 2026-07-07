<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ middleware: ['auth', 'school'], layout: 'dashboard' })

const { t } = useI18n()
const toast = useToast()
const { data: context } = await useAppContext()

const active = computed(() => activeMembershipOf(context.value))
const isOwner = computed(() => active.value?.role === 'owner')

interface SettingsForm {
  name: string
  slug: string
}

const state = reactive<SettingsForm>({
  name: active.value?.organization.name ?? '',
  slug: active.value?.organization.slug ?? ''
})

watch(active, (value) => {
  state.name = value?.organization.name ?? ''
  state.slug = value?.organization.slug ?? ''
})

const saving = ref(false)

function validate(form: SettingsForm) {
  return validateSchoolForm(form, t)
}

async function onSave(event: FormSubmitEvent<SettingsForm>) {
  if (!active.value) {
    return
  }

  saving.value = true
  const { error } = await authClient.organization.update({
    organizationId: active.value.organization.id,
    data: {
      name: event.data.name.trim(),
      slug: event.data.slug
    }
  })
  saving.value = false

  if (error) {
    const description = error.code === 'SLUG_IS_TAKEN' ? t('onboarding.errors.slugTaken') : error.message
    toast.add({ title: t('school.settings.errors.saveFailed'), description, color: 'error' })
    return
  }

  await refreshAppContext()
  toast.add({ title: t('school.settings.saved'), color: 'success' })
}

const deleteOpen = ref(false)
const deleteConfirmation = ref('')
const deleting = ref(false)

const deleteConfirmed = computed(() =>
  deleteConfirmation.value.trim() === active.value?.organization.name
)

watch(deleteOpen, (value) => {
  if (!value) {
    deleteConfirmation.value = ''
  }
})

async function onDelete() {
  if (!active.value || !deleteConfirmed.value) {
    return
  }

  deleting.value = true
  const { error } = await authClient.organization.delete({
    organizationId: active.value.organization.id
  })
  deleting.value = false

  if (error) {
    toast.add({ title: t('school.settings.errors.deleteFailed'), description: error.message, color: 'error' })
    return
  }

  deleteOpen.value = false
  toast.add({ title: t('school.settings.deleted'), color: 'neutral' })
  await Promise.all([refreshAuthSession(), refreshAppContext()])
  await navigateTo('/dashboard')
}
</script>

<template>
  <UDashboardPanel id="school-settings">
    <template #header>
      <UDashboardNavbar :title="t('nav.settings')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <LocaleSwitcher />
          <ColorModeButton />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="mx-auto flex w-full max-w-2xl flex-col gap-8">
        <UCard variant="subtle">
          <template #header>
            <h2 class="font-semibold text-highlighted">
              {{ t('school.settings.profile.title') }}
            </h2>
            <p class="mt-1 text-sm text-muted">
              {{ t('school.settings.profile.subtitle') }}
            </p>
          </template>

          <UForm
            :state="state"
            :validate="validate"
            class="flex flex-col gap-5"
            @submit="onSave"
          >
            <UFormField
              :label="t('onboarding.fields.schoolName')"
              name="name"
            >
              <UInput
                v-model="state.name"
                size="lg"
                class="w-full"
              />
            </UFormField>

            <UFormField
              :label="t('onboarding.fields.slug')"
              name="slug"
              :help="t('onboarding.fields.slugHelp')"
            >
              <UInput
                v-model="state.slug"
                size="lg"
                icon="i-lucide-link"
                class="w-full font-mono"
              />
            </UFormField>

            <div class="flex justify-end">
              <UButton
                type="submit"
                :loading="saving"
                :label="t('common.save')"
              />
            </div>
          </UForm>
        </UCard>

        <UCard
          v-if="isOwner"
          variant="subtle"
          class="ring-error/25"
        >
          <template #header>
            <h2 class="font-semibold text-error">
              {{ t('school.settings.danger.title') }}
            </h2>
            <p class="mt-1 text-sm text-muted">
              {{ t('school.settings.danger.subtitle') }}
            </p>
          </template>

          <div class="flex flex-wrap items-center justify-between gap-4">
            <p class="text-sm text-muted">
              {{ t('school.settings.danger.deleteHint') }}
            </p>
            <UButton
              color="error"
              variant="subtle"
              icon="i-lucide-trash-2"
              :label="t('school.settings.danger.delete')"
              @click="deleteOpen = true"
            />
          </div>
        </UCard>
      </div>

      <UModal
        v-model:open="deleteOpen"
        :title="t('school.settings.danger.confirmTitle')"
        :description="t('school.settings.danger.confirmDescription', { name: active?.organization.name })"
      >
        <template #body>
          <UFormField :label="t('school.settings.danger.confirmLabel', { name: active?.organization.name })">
            <UInput
              v-model="deleteConfirmation"
              size="lg"
              class="w-full"
              :placeholder="active?.organization.name"
            />
          </UFormField>
        </template>
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :label="t('common.cancel')"
              @click="deleteOpen = false"
            />
            <UButton
              color="error"
              :disabled="!deleteConfirmed"
              :loading="deleting"
              :label="t('school.settings.danger.delete')"
              @click="onDelete"
            />
          </div>
        </template>
      </UModal>
    </template>
  </UDashboardPanel>
</template>
