// Single source for building and copying invite links, shared by the invite
// modal and the members page. Owns the "copied" feedback timer and clears it on
// unmount so it can't fire after the component is gone.
export function useInviteLink() {
  const { t } = useI18n()
  const toast = useToast()
  const origin = useRequestURL().origin

  const copiedId = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null

  function linkFor(invitationId: string) {
    return `${origin}/invite/${invitationId}`
  }

  async function copy(invitationId: string) {
    try {
      await navigator.clipboard.writeText(linkFor(invitationId))
      copiedId.value = invitationId
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        copiedId.value = null
      }, 2000)
    } catch {
      toast.add({ title: t('school.invite.copyFailed'), color: 'error' })
    }
  }

  onScopeDispose(() => {
    if (timer) clearTimeout(timer)
  })

  return { copiedId, linkFor, copy }
}
