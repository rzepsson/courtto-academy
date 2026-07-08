// Copy-to-clipboard with keyed "copied" feedback. The active key drives the
// per-button checkmark (so several copy buttons can share one composable and
// only the clicked one flips). Owns the reset timer and clears it on unmount so
// it can't fire after the component is gone.
export function useClipboard() {
  const { t } = useI18n()
  const toast = useToast()

  const copiedKey = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null

  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      copiedKey.value = key
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        copiedKey.value = null
      }, 2000)
    } catch {
      toast.add({ title: t('common.copyFailed'), color: 'error' })
    }
  }

  onScopeDispose(() => {
    if (timer) clearTimeout(timer)
  })

  return { copiedKey, copy }
}
