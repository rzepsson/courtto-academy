export function useOrgSwitch() {
  const { t } = useI18n()
  const toast = useToast()
  const { data: context } = useAppContext()

  const switching = ref(false)

  async function switchTo(organizationId: string) {
    const current = activeMembershipOf(context.value)

    if (switching.value || organizationId === current?.organization.id) {
      return
    }

    switching.value = true
    const { error } = await authClient.organization.setActive({ organizationId })

    if (error) {
      switching.value = false
      toast.add({ title: t('orgSwitcher.switchFailed'), description: error.message, color: 'error' })
      return
    }

    await Promise.all([refreshAuthSession(), refreshAppContext()])
    const next = activeMembershipOf(context.value)
    switching.value = false
    await navigateTo(next ? roleHome(next.role) : '/dashboard')
  }

  return { switching, switchTo }
}
