// Builds and copies personal invite links, shared by the invite modal and the
// members page. Thin wrapper over useClipboard, keyed by invitation id so each
// row's copy button flips independently.
export function useInviteLink() {
  const origin = useRequestURL().origin
  const { copiedKey, copy } = useClipboard()

  function linkFor(invitationId: string) {
    return `${origin}/invite/${invitationId}`
  }

  function copyLink(invitationId: string) {
    return copy(invitationId, linkFor(invitationId))
  }

  return { copiedId: copiedKey, linkFor, copy: copyLink }
}
