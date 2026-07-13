import type { CourtView } from '~/utils/courts'

// The court lifecycle mutations (archive / restore / permanent delete), shared by
// the roster and the detail page so the HTTP + toast + error handling live in one
// place. Each returns whether it succeeded; the CALLER owns what happens next
// (refetch on the roster, navigate away on the detail page), so this composable
// never assumes a single post-action behaviour.
export function useCourtActions() {
  const { t } = useI18n()
  const toast = useToast()
  const { toastError } = useApiError()

  // Permanent delete runs behind a confirm dialog; expose its in-flight state so
  // the dialog's button can show a spinner.
  const purging = ref(false)

  async function archive(court: CourtView): Promise<boolean> {
    // Annotated string so typed $fetch doesn't intersect this dynamic path with
    // the sibling /courts/reorder route (which would forbid DELETE).
    const endpoint: string = `/api/school/courts/${court.id}`
    try {
      await $fetch(endpoint, { method: 'DELETE' })
      toast.add({ title: t('courts.archived'), color: 'neutral' })
      return true
    } catch (error) {
      toastError('courts.errors.archiveFailed', error)
      return false
    }
  }

  async function restore(court: CourtView): Promise<boolean> {
    try {
      await $fetch(`/api/school/courts/${court.id}`, { method: 'PATCH', body: { restore: true } })
      toast.add({ title: t('courts.restored'), color: 'success' })
      return true
    } catch (error) {
      toastError('courts.errors.restoreFailed', error)
      return false
    }
  }

  async function purge(court: CourtView): Promise<boolean> {
    purging.value = true
    const endpoint: string = `/api/school/courts/${court.id}?purge=1`
    try {
      await $fetch(endpoint, { method: 'DELETE' })
      toast.add({ title: t('courts.deleted'), color: 'neutral' })
      return true
    } catch (error) {
      toastError('courts.errors.deleteFailed', error)
      return false
    } finally {
      purging.value = false
    }
  }

  return { purging, archive, restore, purge }
}
