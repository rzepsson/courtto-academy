<script setup lang="ts">
import type { FormSubmitEvent } from '@nuxt/ui'
import type { ProfileFormState } from '~/utils/orgProfile'
import type { OrgProfileInput } from '~~/server/database/types'

definePageMeta({ middleware: ['auth', 'school'], layout: 'dashboard' })

const { t, locale } = useI18n()
const toast = useToast()
const { toastError } = useApiError()
const { data: context } = await useAppContext()

const active = computed(() => activeMembershipOf(context.value))
const isOwner = computed(() => active.value?.role === 'owner')
const orgId = computed(() => active.value?.organization.id ?? null)

// --- Sticky section nav + scroll-spy ---
const navSections = computed(() => {
  const base = [
    { id: 'general', label: t('school.settings.general.title') },
    { id: 'public', label: t('school.settings.publicProfile.title') },
    { id: 'contact', label: t('school.settings.contact.title') },
    { id: 'location', label: t('school.settings.location.title') },
    { id: 'regional', label: t('school.settings.regional.title') },
    { id: 'business', label: t('school.settings.business.title') }
  ]
  return isOwner.value ? [...base, { id: 'danger', label: t('school.settings.danger.title') }] : base
})

const activeSection = ref('general')
const contentEl = ref<HTMLElement>()

// While a nav click is smooth-scrolling, the browser emits `scroll` events that
// would otherwise let the spy fight the click (e.g. a short final section can't
// reach the top, so the container bottoms out and the spy snaps to the last
// item). So we lock the spy on click and only release it on a real user scroll
// gesture (wheel / touch / keyboard) — never on the programmatic scroll itself.
let spyLocked = false

function releaseSpy() {
  spyLocked = false
}

// Scroll-spy against the content scroller: the active section is the last one
// whose top has crossed a threshold below the container's top edge, so exactly
// one is highlighted even when several are visible. Snaps to the last section
// once genuinely scrolled to the bottom (a short final section can't reach the
// top on its own).
function updateActiveSection() {
  const container = contentEl.value
  if (!container) {
    return
  }

  if (container.scrollTop + container.clientHeight >= container.scrollHeight - 4) {
    activeSection.value = navSections.value.at(-1)?.id ?? 'general'
    return
  }

  const containerTop = container.getBoundingClientRect().top
  const threshold = 120
  let current = navSections.value[0]?.id ?? 'general'
  for (const section of navSections.value) {
    const el = document.getElementById(section.id)
    if (el && el.getBoundingClientRect().top - containerTop <= threshold) {
      current = section.id
    }
  }
  activeSection.value = current
}

let ticking = false
function onContentScroll() {
  if (spyLocked || ticking) {
    return
  }
  ticking = true
  requestAnimationFrame(() => {
    updateActiveSection()
    ticking = false
  })
}

onMounted(() => {
  nextTick(updateActiveSection)
  const el = contentEl.value
  el?.addEventListener('wheel', releaseSpy, { passive: true })
  el?.addEventListener('touchmove', releaseSpy, { passive: true })
  window.addEventListener('keydown', releaseSpy)
})

onBeforeUnmount(() => {
  const el = contentEl.value
  el?.removeEventListener('wheel', releaseSpy)
  el?.removeEventListener('touchmove', releaseSpy)
  window.removeEventListener('keydown', releaseSpy)
})

function scrollToSection(id: string) {
  activeSection.value = id
  spyLocked = true
  document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// --- Section field groups (also used for dirty-checks and PATCH bodies) ---
const PUBLIC_KEYS = ['description', 'sports'] as const
const CONTACT_KEYS = ['contactEmail', 'contactPhone', 'websiteUrl', 'instagramUrl', 'facebookUrl'] as const
const LOCATION_KEYS = ['addressLine1', 'addressLine2', 'city', 'postalCode', 'country'] as const
const REGIONAL_KEYS = ['timezone', 'locale', 'currency'] as const
const BUSINESS_KEYS = ['legalName', 'taxId'] as const

type SectionKey = keyof ProfileFormState
type SectionName = 'public' | 'contact' | 'location' | 'regional' | 'business'

function emptyProfile(): ProfileFormState {
  return {
    description: '', sports: [], contactEmail: '', contactPhone: '', websiteUrl: '',
    instagramUrl: '', facebookUrl: '', addressLine1: '', addressLine2: '', city: '',
    postalCode: '', country: '', timezone: '', locale: '', currency: '', legalName: '', taxId: ''
  }
}

function toFormState(p: OrgProfileInput | undefined | null): ProfileFormState {
  const base = emptyProfile()
  if (!p) {
    return base
  }
  for (const key of Object.keys(base) as SectionKey[]) {
    const value = p[key]
    if (key === 'sports') {
      base.sports = [...(p.sports ?? [])]
    } else if (typeof value === 'string') {
      base[key] = value as never
    }
  }
  return base
}

// --- Extended profile (app-owned org_profile table) ---
const { data: profileData } = await useFetch('/api/school/profile', { key: 'school-profile' })

const state = reactive<ProfileFormState>(emptyProfile())
const baseline = reactive<ProfileFormState>(emptyProfile())

function applyProfile(profile: OrgProfileInput | undefined | null) {
  const flat = toFormState(profile)
  Object.assign(state, flat)
  Object.assign(baseline, JSON.parse(JSON.stringify(flat)))
}

watch(profileData, value => applyProfile(value?.profile), { immediate: true })

const saving = reactive<Record<SectionName, boolean>>({
  public: false, contact: false, location: false, regional: false, business: false
})

function isDirty(keys: readonly SectionKey[]): boolean {
  return keys.some((key) => {
    const current = state[key]
    const original = baseline[key]
    return Array.isArray(current)
      ? JSON.stringify(current) !== JSON.stringify(original)
      : current !== original
  })
}

const publicDirty = computed(() => isDirty(PUBLIC_KEYS))
const contactDirty = computed(() => isDirty(CONTACT_KEYS))
const locationDirty = computed(() => isDirty(LOCATION_KEYS))
const regionalDirty = computed(() => isDirty(REGIONAL_KEYS))
const businessDirty = computed(() => isDirty(BUSINESS_KEYS))

function discardSection(keys: readonly SectionKey[]) {
  for (const key of keys) {
    if (key === 'sports') {
      state.sports = [...baseline.sports]
    } else {
      state[key] = baseline[key] as never
    }
  }
}

async function saveSection(keys: readonly SectionKey[], section: SectionName) {
  if (!orgId.value) {
    return
  }
  saving[section] = true
  const body: Record<string, unknown> = {}
  for (const key of keys) {
    body[key] = state[key]
  }
  try {
    const { profile } = await $fetch<{ profile: OrgProfileInput }>('/api/school/profile', { method: 'PATCH', body })
    applyProfile(profile)
    toast.add({ title: t('school.settings.saved'), color: 'success' })
  } catch (error) {
    toastError('school.settings.errors.saveFailed', error)
  } finally {
    saving[section] = false
  }
}

const validatePublic = () => validateProfileFields(PUBLIC_KEYS, state, t)
const validateContact = () => validateProfileFields(CONTACT_KEYS, state, t)
const validateLocation = () => validateProfileFields(LOCATION_KEYS, state, t)

function toggleSport(sport: string) {
  const index = state.sports.indexOf(sport)
  if (index === -1) {
    state.sports.push(sport)
  } else {
    state.sports.splice(index, 1)
  }
}

// --- Regional select options (built from Intl, localized to the UI language) ---
const timezones = computed(() => timezoneOptions())
const currencies = computed(() => currencyOptions(locale.value))
const countries = computed(() => countryOptions(locale.value))
const languages = computed<{ value: string, label: string }[]>(() => PROFILE_LOCALES.map(code => ({
  value: code,
  label: t(`school.settings.languages.${code}`)
})))

// --- General section (name / slug / logo) via Better Auth ---
interface GeneralForm {
  name: string
  slug: string
}

const general = reactive<GeneralForm>({ name: '', slug: '' })
const logo = ref<string | null>(null)

watch(active, (value) => {
  general.name = value?.organization.name ?? ''
  general.slug = value?.organization.slug ?? ''
  logo.value = value?.organization.logo ?? null
}, { immediate: true })

const generalDirty = computed(() =>
  general.name !== (active.value?.organization.name ?? '')
  || general.slug !== (active.value?.organization.slug ?? '')
)

function discardGeneral() {
  general.name = active.value?.organization.name ?? ''
  general.slug = active.value?.organization.slug ?? ''
}

const anyDirty = computed(() =>
  generalDirty.value || publicDirty.value || contactDirty.value
  || locationDirty.value || regionalDirty.value || businessDirty.value
)

const savingGeneral = ref(false)

async function onSaveGeneral(event: FormSubmitEvent<GeneralForm>) {
  if (!orgId.value) {
    return
  }
  savingGeneral.value = true
  const { error } = await authClient.organization.update({
    organizationId: orgId.value,
    data: { name: event.data.name.trim(), slug: event.data.slug }
  })
  savingGeneral.value = false

  if (error) {
    toastError('school.settings.errors.saveFailed', error)
    return
  }

  await refreshAppContext()
  toast.add({ title: t('school.settings.saved'), color: 'success' })
}

// --- Logo upload (S3-compatible storage via /api/school/logo) ---
const logoInput = ref<HTMLInputElement>()
const uploadingLogo = ref(false)

function pickLogo() {
  logoInput.value?.click()
}

async function persistLogo(url: string | null) {
  if (!orgId.value) {
    return
  }
  // Better Auth rejects null; an empty string clears the logo.
  const { error } = await authClient.organization.update({
    organizationId: orgId.value,
    data: { logo: url ?? '' }
  })
  if (error) {
    throw error
  }
  logo.value = url
  await refreshAppContext()
}

async function onLogoChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !orgId.value) {
    return
  }

  uploadingLogo.value = true
  try {
    const form = new FormData()
    form.append('file', file)
    const { url } = await $fetch<{ url: string }>('/api/school/logo', { method: 'POST', body: form })
    await persistLogo(url)
    toast.add({ title: t('school.settings.logoUpdated'), color: 'success' })
  } catch (error) {
    toastError('school.settings.errors.uploadFailed', error)
  } finally {
    uploadingLogo.value = false
  }
}

async function removeLogo() {
  try {
    await persistLogo(null)
  } catch (error) {
    toastError('school.settings.errors.saveFailed', error)
  }
}

// --- Unsaved-changes guard (in-app route leave + browser unload) ---
const leaveOpen = ref(false)
let resolveLeave: ((leave: boolean) => void) | null = null
// Set before intentional programmatic navigation (e.g. after deleting the
// school) so the guard doesn't trap the redirect over now-stale form state.
let bypassGuard = false

onBeforeRouteLeave(() => {
  if (bypassGuard || !anyDirty.value) {
    return true
  }
  leaveOpen.value = true
  return new Promise<boolean>((resolve) => {
    resolveLeave = resolve
  })
})

function confirmLeave() {
  resolveLeave?.(true)
  resolveLeave = null
  leaveOpen.value = false
}

// Closing the modal any other way (Cancel, ESC, backdrop) means "stay".
watch(leaveOpen, (open) => {
  if (!open && resolveLeave) {
    resolveLeave(false)
    resolveLeave = null
  }
})

function onBeforeUnload(event: BeforeUnloadEvent) {
  if (anyDirty.value) {
    event.preventDefault()
  }
}

onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

// --- Danger zone ---
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
    toastError('school.settings.errors.deleteFailed', error)
    return
  }

  deleteOpen.value = false
  toast.add({ title: t('school.settings.deleted'), color: 'neutral' })
  bypassGuard = true
  await Promise.all([refreshAuthSession(), refreshAppContext()])
  await navigateTo('/dashboard')
}
</script>

<template>
  <UDashboardPanel
    id="school-settings"
    :ui="{ body: 'flex-row min-h-0 gap-0 p-0' }"
  >
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
      <!-- Secondary section sidebar (desktop) -->
      <nav class="hidden w-56 shrink-0 overflow-y-auto border-e border-default px-3 py-6 lg:block">
        <p class="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-dimmed">
          {{ t('nav.settings') }}
        </p>
        <ul class="flex flex-col gap-0.5">
          <li
            v-for="section in navSections"
            :key="section.id"
            class="relative"
          >
            <Motion
              v-if="activeSection === section.id"
              layout-id="settingsNavActive"
              class="absolute inset-0 rounded-md bg-elevated"
              :transition="{ type: 'spring', stiffness: 550, damping: 42 }"
            />
            <button
              type="button"
              class="relative w-full rounded-md px-3 py-1.5 text-left text-sm transition-colors"
              :class="activeSection === section.id
                ? 'font-medium text-highlighted'
                : 'text-muted hover:bg-elevated/50 hover:text-default'"
              @click="scrollToSection(section.id)"
            >
              {{ section.label }}
            </button>
          </li>
        </ul>
      </nav>

      <!-- Content scroller -->
      <div
        ref="contentEl"
        class="min-w-0 flex-1 overflow-y-auto"
        @scroll="onContentScroll"
      >
        <div class="max-w-4xl px-6 py-8 lg:px-10 lg:py-10">
          <MotionReveal>
            <p class="mb-10 max-w-2xl text-sm text-muted">
              {{ t('school.settings.tagline') }}
            </p>
          </MotionReveal>

          <div class="flex flex-col gap-12">
            <!-- General: name, slug, logo -->
            <MotionReveal :delay="0.04">
              <SchoolSettingsCard
                id="general"
                :title="t('school.settings.general.title')"
                :subtitle="t('school.settings.general.subtitle')"
                :state="general"
                :validate="(f) => validateSchoolForm(f as GeneralForm, t)"
                :dirty="generalDirty"
                :saving="savingGeneral"
                @submit="onSaveGeneral({ data: general } as FormSubmitEvent<GeneralForm>)"
                @discard="discardGeneral"
              >
                <UFormField
                  :label="t('school.settings.logo.label')"
                  :help="t('school.settings.logo.hint')"
                >
                  <div class="flex items-center gap-4">
                    <div class="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-elevated ring-1 ring-default">
                      <img
                        v-if="logo"
                        :src="logo"
                        alt=""
                        class="size-full object-cover"
                      >
                      <UIcon
                        v-else
                        name="i-lucide-image"
                        class="size-6 text-dimmed"
                      />
                    </div>
                    <div class="flex items-center gap-2">
                      <UButton
                        size="sm"
                        variant="subtle"
                        icon="i-lucide-upload"
                        :loading="uploadingLogo"
                        :label="logo ? t('school.settings.logo.change') : t('school.settings.logo.upload')"
                        @click="pickLogo"
                      />
                      <UButton
                        v-if="logo"
                        size="sm"
                        color="neutral"
                        variant="ghost"
                        icon="i-lucide-x"
                        :label="t('school.settings.logo.remove')"
                        @click="removeLogo"
                      />
                    </div>
                    <input
                      ref="logoInput"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      class="hidden"
                      @change="onLogoChange"
                    >
                  </div>
                </UFormField>

                <UFormField
                  :label="t('onboarding.fields.schoolName')"
                  name="name"
                >
                  <UInput
                    v-model="general.name"
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
                    v-model="general.slug"
                    size="lg"
                    icon="i-lucide-link"
                    class="w-full font-mono"
                  />
                </UFormField>
              </SchoolSettingsCard>
            </MotionReveal>

            <!-- Public profile: description, sports -->
            <MotionReveal :delay="0.08">
              <SchoolSettingsCard
                id="public"
                :title="t('school.settings.publicProfile.title')"
                :subtitle="t('school.settings.publicProfile.subtitle')"
                :state="state"
                :validate="validatePublic"
                :dirty="publicDirty"
                :saving="saving.public"
                @submit="saveSection(PUBLIC_KEYS, 'public')"
                @discard="discardSection(PUBLIC_KEYS)"
              >
                <UFormField
                  :label="t('school.settings.publicProfile.description')"
                  name="description"
                >
                  <UTextarea
                    v-model="state.description"
                    :rows="3"
                    autoresize
                    size="lg"
                    class="w-full"
                    :placeholder="t('school.settings.publicProfile.descriptionPlaceholder')"
                  />
                </UFormField>

                <UFormField
                  :label="t('school.settings.publicProfile.sports')"
                  :help="t('school.settings.publicProfile.sportsHint')"
                >
                  <div class="flex flex-wrap gap-2">
                    <Motion
                      v-for="sport in SPORTS"
                      :key="sport"
                      :while-press="{ scale: 0.96 }"
                      :transition="{ type: 'spring', stiffness: 500, damping: 30 }"
                    >
                      <button
                        type="button"
                        class="rounded-full px-4 py-1.5 text-sm font-medium ring-1 transition-colors"
                        :class="state.sports.includes(sport)
                          ? 'bg-primary text-inverted ring-primary'
                          : 'bg-default text-muted ring-default hover:text-default hover:ring-inverted/20'"
                        @click="toggleSport(sport)"
                      >
                        {{ t(`school.settings.sports.${sport}`) }}
                      </button>
                    </Motion>
                  </div>
                </UFormField>
              </SchoolSettingsCard>
            </MotionReveal>

            <!-- Contact -->
            <MotionReveal :delay="0.12">
              <SchoolSettingsCard
                id="contact"
                :title="t('school.settings.contact.title')"
                :subtitle="t('school.settings.contact.subtitle')"
                :state="state"
                :validate="validateContact"
                :dirty="contactDirty"
                :saving="saving.contact"
                @submit="saveSection(CONTACT_KEYS, 'contact')"
                @discard="discardSection(CONTACT_KEYS)"
              >
                <div class="grid gap-5 sm:grid-cols-2">
                  <UFormField
                    :label="t('school.settings.contact.email')"
                    name="contactEmail"
                  >
                    <UInput
                      v-model="state.contactEmail"
                      type="email"
                      size="lg"
                      icon="i-lucide-mail"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField
                    :label="t('school.settings.contact.phone')"
                    name="contactPhone"
                  >
                    <UInput
                      v-model="state.contactPhone"
                      size="lg"
                      icon="i-lucide-phone"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField
                    :label="t('school.settings.contact.website')"
                    name="websiteUrl"
                    class="sm:col-span-2"
                  >
                    <UInput
                      v-model="state.websiteUrl"
                      size="lg"
                      icon="i-lucide-globe"
                      placeholder="https://"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField
                    :label="t('school.settings.contact.instagram')"
                    name="instagramUrl"
                  >
                    <UInput
                      v-model="state.instagramUrl"
                      size="lg"
                      icon="i-simple-icons-instagram"
                      placeholder="https://"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField
                    :label="t('school.settings.contact.facebook')"
                    name="facebookUrl"
                  >
                    <UInput
                      v-model="state.facebookUrl"
                      size="lg"
                      icon="i-simple-icons-facebook"
                      placeholder="https://"
                      class="w-full"
                    />
                  </UFormField>
                </div>
              </SchoolSettingsCard>
            </MotionReveal>

            <!-- Location -->
            <MotionReveal :delay="0.16">
              <SchoolSettingsCard
                id="location"
                :title="t('school.settings.location.title')"
                :subtitle="t('school.settings.location.subtitle')"
                :state="state"
                :validate="validateLocation"
                :dirty="locationDirty"
                :saving="saving.location"
                @submit="saveSection(LOCATION_KEYS, 'location')"
                @discard="discardSection(LOCATION_KEYS)"
              >
                <UFormField
                  :label="t('school.settings.location.addressLine1')"
                  name="addressLine1"
                >
                  <UInput
                    v-model="state.addressLine1"
                    size="lg"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  :label="t('school.settings.location.addressLine2')"
                  name="addressLine2"
                >
                  <UInput
                    v-model="state.addressLine2"
                    size="lg"
                    class="w-full"
                  />
                </UFormField>
                <div class="grid gap-5 sm:grid-cols-3">
                  <UFormField
                    :label="t('school.settings.location.postalCode')"
                    name="postalCode"
                  >
                    <UInput
                      v-model="state.postalCode"
                      size="lg"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField
                    :label="t('school.settings.location.city')"
                    name="city"
                    class="sm:col-span-2"
                  >
                    <UInput
                      v-model="state.city"
                      size="lg"
                      class="w-full"
                    />
                  </UFormField>
                </div>
                <UFormField
                  :label="t('school.settings.location.country')"
                  name="country"
                >
                  <USelectMenu
                    v-model="state.country"
                    value-key="value"
                    :items="countries"
                    size="lg"
                    class="w-full"
                  />
                </UFormField>
              </SchoolSettingsCard>
            </MotionReveal>

            <!-- Regional -->
            <MotionReveal :delay="0.2">
              <SchoolSettingsCard
                id="regional"
                :title="t('school.settings.regional.title')"
                :subtitle="t('school.settings.regional.subtitle')"
                :state="state"
                :dirty="regionalDirty"
                :saving="saving.regional"
                @submit="saveSection(REGIONAL_KEYS, 'regional')"
                @discard="discardSection(REGIONAL_KEYS)"
              >
                <UFormField
                  :label="t('school.settings.regional.timezone')"
                  name="timezone"
                >
                  <USelectMenu
                    v-model="state.timezone"
                    value-key="value"
                    :items="timezones"
                    icon="i-lucide-clock"
                    size="lg"
                    class="w-full"
                  />
                </UFormField>
                <div class="grid gap-5 sm:grid-cols-2">
                  <UFormField
                    :label="t('school.settings.regional.language')"
                    name="locale"
                  >
                    <USelect
                      v-model="state.locale"
                      value-key="value"
                      :items="languages"
                      icon="i-lucide-languages"
                      size="lg"
                      class="w-full"
                    />
                  </UFormField>
                  <UFormField
                    :label="t('school.settings.regional.currency')"
                    name="currency"
                  >
                    <USelectMenu
                      v-model="state.currency"
                      value-key="value"
                      :items="currencies"
                      icon="i-lucide-banknote"
                      size="lg"
                      class="w-full"
                    />
                  </UFormField>
                </div>
              </SchoolSettingsCard>
            </MotionReveal>

            <!-- Business -->
            <MotionReveal :delay="0.24">
              <SchoolSettingsCard
                id="business"
                :title="t('school.settings.business.title')"
                :subtitle="t('school.settings.business.subtitle')"
                :state="state"
                :dirty="businessDirty"
                :saving="saving.business"
                @submit="saveSection(BUSINESS_KEYS, 'business')"
                @discard="discardSection(BUSINESS_KEYS)"
              >
                <UFormField
                  :label="t('school.settings.business.legalName')"
                  name="legalName"
                >
                  <UInput
                    v-model="state.legalName"
                    size="lg"
                    class="w-full"
                  />
                </UFormField>
                <UFormField
                  :label="t('school.settings.business.taxId')"
                  name="taxId"
                >
                  <UInput
                    v-model="state.taxId"
                    size="lg"
                    class="w-full font-mono"
                  />
                </UFormField>
              </SchoolSettingsCard>
            </MotionReveal>

            <!-- Danger zone -->
            <MotionReveal
              v-if="isOwner"
              :delay="0.28"
            >
              <SchoolSettingsCard
                id="danger"
                tone="danger"
                :form="false"
                :title="t('school.settings.danger.title')"
                :subtitle="t('school.settings.danger.subtitle')"
              >
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
              </SchoolSettingsCard>
            </MotionReveal>
          </div>
        </div>
      </div>

      <UModal
        v-model:open="leaveOpen"
        :title="t('school.settings.unsaved.title')"
        :description="t('school.settings.unsaved.description')"
      >
        <template #footer>
          <div class="flex w-full justify-end gap-2">
            <UButton
              color="neutral"
              variant="ghost"
              :label="t('school.settings.unsaved.stay')"
              @click="leaveOpen = false"
            />
            <UButton
              color="error"
              variant="subtle"
              :label="t('school.settings.unsaved.leave')"
              @click="confirmLeave"
            />
          </div>
        </template>
      </UModal>

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
