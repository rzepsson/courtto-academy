<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ middleware: 'auth', layout: 'auth' })

const { t } = useI18n()
const toast = useToast()
const { data: context } = await useAppContext()

const hasMemberships = computed(() => (context.value?.memberships.length ?? 0) > 0)
const mode = ref<'create' | 'join'>('create')

interface CreateSchoolForm {
  name: string
  slug: string
}

const state = reactive<CreateSchoolForm>({ name: '', slug: '' })
const slugEdited = ref(false)
const creating = ref(false)

watch(() => state.name, (name) => {
  if (!slugEdited.value) {
    state.slug = slugify(name)
  }
})

function validate(form: CreateSchoolForm) {
  return validateSchoolForm(form, t)
}

async function onCreate(event: FormSubmitEvent<CreateSchoolForm>) {
  creating.value = true
  const { data, error } = await authClient.organization.create({
    name: event.data.name.trim(),
    slug: event.data.slug
  })

  if (error || !data) {
    creating.value = false
    const description = error?.code === 'SLUG_IS_TAKEN' ? t('onboarding.errors.slugTaken') : error?.message
    toast.add({ title: t('onboarding.errors.createFailed'), description, color: 'error' })
    return
  }

  await authClient.organization.setActive({ organizationId: data.id })
  await Promise.all([refreshAuthSession(), refreshAppContext()])
  await navigateTo('/school')
}

const inviteInput = ref('')
const inviteError = ref(false)

async function onJoin() {
  const id = extractInvitationId(inviteInput.value)

  if (!id) {
    inviteError.value = true
    return
  }

  inviteError.value = false
  await navigateTo(`/invite/${id}`)
}
</script>

<template>
  <div class="w-full">
    <div class="text-center">
      <h1 class="text-2xl font-semibold tracking-tight text-highlighted">
        {{ mode === 'create' ? t('onboarding.create.title') : t('onboarding.join.title') }}
      </h1>
      <p class="mt-2 text-sm text-muted">
        {{ mode === 'create' ? t('onboarding.create.subtitle') : t('onboarding.join.subtitle') }}
      </p>
    </div>

    <UForm
      v-if="mode === 'create'"
      :state="state"
      :validate="validate"
      class="mt-8 flex flex-col gap-5"
      @submit="onCreate"
    >
      <UFormField
        :label="t('onboarding.fields.schoolName')"
        name="name"
      >
        <UInput
          v-model="state.name"
          size="lg"
          :placeholder="t('onboarding.fields.schoolNamePlaceholder')"
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
          @input="slugEdited = true"
        />
      </UFormField>

      <PressButton
        type="submit"
        class="mt-1"
        trailing-icon="i-lucide-arrow-right"
        :loading="creating"
        :label="t('onboarding.create.submit')"
      />
    </UForm>

    <div
      v-else
      class="mt-8 flex flex-col gap-5"
    >
      <UFormField
        :label="t('onboarding.fields.inviteLink')"
        name="invite"
        :error="inviteError ? t('onboarding.errors.inviteInvalid') : undefined"
      >
        <UInput
          v-model="inviteInput"
          size="lg"
          icon="i-lucide-ticket"
          :placeholder="t('onboarding.fields.invitePlaceholder')"
          class="w-full"
          @keydown.enter="onJoin"
        />
      </UFormField>

      <PressButton
        class="mt-1"
        trailing-icon="i-lucide-arrow-right"
        :label="t('onboarding.join.submit')"
        @click="onJoin"
      />
    </div>

    <USeparator class="my-8" />

    <p class="text-center text-sm text-muted">
      <template v-if="mode === 'create'">
        {{ t('onboarding.join.prompt') }}
        <UButton
          variant="link"
          class="p-0 font-medium"
          :label="t('onboarding.join.cta')"
          @click="mode = 'join'"
        />
      </template>
      <template v-else>
        {{ t('onboarding.create.prompt') }}
        <UButton
          variant="link"
          class="p-0 font-medium"
          :label="t('onboarding.create.cta')"
          @click="mode = 'create'"
        />
      </template>
    </p>

    <p
      v-if="hasMemberships"
      class="mt-4 text-center text-sm"
    >
      <ULink
        to="/dashboard"
        class="font-medium text-muted hover:text-highlighted"
      >
        {{ t('onboarding.backToDashboard') }}
      </ULink>
    </p>
  </div>
</template>
