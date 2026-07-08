<script setup lang="ts">
import type { FormError, FormSubmitEvent } from '@nuxt/ui'
import { INVITABLE_ROLES } from '~~/shared/permissions'
import type { InvitableRole } from '~~/shared/permissions'

const open = defineModel<boolean>('open', { required: true })
const emit = defineEmits<{ created: [] }>()

const { t } = useI18n()
const toast = useToast()
const { copiedId, linkFor, copy } = useInviteLink()

interface InviteForm {
  email: string
  role: InvitableRole
}

const state = reactive<InviteForm>({ email: '', role: 'student' })
const sending = ref(false)
const createdId = ref<string | null>(null)
const inviteLink = computed(() => createdId.value ? linkFor(createdId.value) : null)

const roleItems = computed(() => INVITABLE_ROLES.map(role => ({
  label: t(`roles.${role}`),
  description: t(`roleDescriptions.${role}`),
  value: role
})))

watch(open, (value) => {
  if (!value) {
    state.email = ''
    state.role = 'student'
    createdId.value = null
  }
})

function validate(form: InviteForm): FormError[] {
  const errors: FormError[] = []
  if (!/^\S+@\S+\.\S+$/.test(form.email.trim())) {
    errors.push({ name: 'email', message: t('school.invite.errors.emailInvalid') })
  }
  return errors
}

async function onSubmit(event: FormSubmitEvent<InviteForm>) {
  sending.value = true
  const { data, error } = await authClient.organization.inviteMember({
    email: event.data.email.trim(),
    role: event.data.role
  })

  sending.value = false

  if (error || !data) {
    toast.add({ title: t('school.invite.errors.failed'), description: error?.message, color: 'error' })
    return
  }

  createdId.value = data.id
  emit('created')
}

function inviteAnother() {
  state.email = ''
  createdId.value = null
}
</script>

<template>
  <UModal
    v-model:open="open"
    :title="inviteLink ? t('school.invite.linkReady.title') : t('school.invite.title')"
    :description="inviteLink ? t('school.invite.linkReady.subtitle') : t('school.invite.subtitle')"
  >
    <template #body>
      <UForm
        v-if="!inviteLink"
        :state="state"
        :validate="validate"
        class="flex flex-col gap-5"
        @submit="onSubmit"
      >
        <UFormField
          :label="t('auth.fields.email')"
          name="email"
        >
          <UInput
            v-model="state.email"
            type="email"
            size="lg"
            icon="i-lucide-mail"
            :placeholder="t('auth.fields.emailPlaceholder')"
            :disabled="sending"
            class="w-full"
          />
        </UFormField>

        <UFormField
          :label="t('school.invite.roleLabel')"
          name="role"
        >
          <URadioGroup
            v-model="state.role"
            :items="roleItems"
            variant="card"
            :disabled="sending"
            :ui="{
              fieldset: 'w-full gap-2',
              item: 'cursor-pointer transition-all duration-200 ease-out hover:border-primary/50 has-data-[state=checked]:bg-primary/5 has-data-[state=checked]:ring-1 has-data-[state=checked]:ring-primary/20 has-data-[state=checked]:shadow-sm'
            }"
          />
        </UFormField>

        <PressButton
          type="submit"
          icon="i-lucide-user-plus"
          :loading="sending"
          :label="t('school.invite.submit')"
        />
      </UForm>

      <div
        v-else
        class="flex flex-col gap-5"
      >
        <MotionReveal :y="8">
          <UAlert
            color="success"
            variant="subtle"
            icon="i-lucide-check-circle-2"
            :title="t('school.invite.linkReady.sentTo', { email: state.email })"
            :description="t('school.invite.linkReady.hint')"
          />
        </MotionReveal>

        <MotionReveal
          :y="8"
          :delay="0.08"
        >
          <UFieldGroup class="w-full">
            <UInput
              :model-value="inviteLink"
              readonly
              class="w-full font-mono"
            />
            <UButton
              color="neutral"
              variant="subtle"
              :icon="copiedId === createdId ? 'i-lucide-check' : 'i-lucide-copy'"
              :label="copiedId === createdId ? t('common.copied') : t('common.copy')"
              @click="createdId && copy(createdId)"
            />
          </UFieldGroup>
        </MotionReveal>

        <MotionReveal
          :y="8"
          :delay="0.16"
          class="flex justify-end gap-2"
        >
          <UButton
            color="neutral"
            variant="ghost"
            :label="t('school.invite.inviteAnother')"
            @click="inviteAnother"
          />
          <UButton
            :label="t('common.done')"
            @click="open = false"
          />
        </MotionReveal>
      </div>
    </template>
  </UModal>
</template>
