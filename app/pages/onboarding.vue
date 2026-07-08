<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'

definePageMeta({ middleware: 'auth', layout: 'auth' })

const { t } = useI18n()
const { toastError } = useApiError()
const { data: context } = await useAppContext()

const hasMemberships = computed(() => (context.value?.memberships.length ?? 0) > 0)
const mode = ref<'create' | 'join'>('join')

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
    toastError('onboarding.errors.createFailed', error)
    return
  }

  await authClient.organization.setActive({ organizationId: data.id })
  await Promise.all([refreshAuthSession(), refreshAppContext()])
  await navigateTo('/school')
}

const inviteInput = ref('')
const inviteError = ref(false)

async function onJoin() {
  const target = resolveJoinTarget(inviteInput.value)

  if (!target) {
    inviteError.value = true
    return
  }

  inviteError.value = false
  await navigateTo(target)
}
</script>

<template>
  <div class="w-full">
    <MotionReveal :y="8">
      <div class="flex flex-col items-center text-center">
        <div class="flex size-14 items-center justify-center rounded-full bg-elevated">
          <UIcon
            :name="mode === 'join' ? 'i-lucide-users-round' : 'i-lucide-building-2'"
            class="size-7 text-primary"
          />
        </div>
        <h1 class="mt-5 text-2xl font-semibold tracking-tight text-highlighted">
          {{ mode === 'create' ? t('onboarding.create.title') : t('onboarding.join.title') }}
        </h1>
        <p class="mt-2 text-sm text-muted">
          {{ mode === 'create' ? t('onboarding.create.subtitle') : t('onboarding.join.subtitle') }}
        </p>
      </div>
    </MotionReveal>

    <MotionReveal
      :y="8"
      :delay="0.08"
    >
      <AnimatePresence mode="wait">
        <Motion
          :key="mode"
          :initial="{ opacity: 0, y: 6 }"
          :animate="{ opacity: 1, y: 0 }"
          :exit="{ opacity: 0, y: -6 }"
          :transition="{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }"
        >
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
              :label="t('onboarding.fields.inviteOrCode')"
              name="invite"
              :help="t('onboarding.fields.inviteHelp')"
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
        </Motion>
      </AnimatePresence>
    </MotionReveal>

    <MotionReveal
      :y="8"
      :delay="0.16"
    >
      <USeparator
        :label="t('onboarding.orDivider')"
        class="my-6"
      />

      <UButton
        block
        size="lg"
        color="neutral"
        variant="subtle"
        :icon="mode === 'join' ? 'i-lucide-building-2' : 'i-lucide-ticket'"
        :label="mode === 'join' ? t('onboarding.switchToCreate') : t('onboarding.switchToJoin')"
        @click="mode = mode === 'join' ? 'create' : 'join'"
      />
    </MotionReveal>

    <MotionReveal
      v-if="hasMemberships"
      :y="8"
      :delay="0.24"
    >
      <p class="mt-6 text-center text-sm">
        <ULink
          to="/dashboard"
          class="font-medium text-muted hover:text-highlighted"
        >
          {{ t('onboarding.backToDashboard') }}
        </ULink>
      </p>
    </MotionReveal>
  </div>
</template>
