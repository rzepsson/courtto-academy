/**
 * Translates errors from Better Auth client calls and internal `/api/*` fetches
 * into localized, user-facing messages.
 *
 * Every failure we surface carries a stable machine-readable code — `error.code`
 * on a Better Auth response, or `data.code` on a Nitro `createError`. That code
 * maps to an i18n string under `error.codes.*`; unknown codes, rate limiting and
 * network failures degrade to localized generic copy. The raw English server
 * text is never rendered. The key-selection policy lives in `~/utils/errors`.
 */
export function useApiError() {
  const { t, te } = useI18n()
  const toast = useToast()

  /** Resolve any error into a localized, user-facing message. */
  function resolve(error: unknown): string {
    return t(resolveErrorKey(error, te))
  }

  /** Show an error toast with a localized title and a resolved description. */
  function toastError(titleKey: string, error: unknown): void {
    toast.add({ title: t(titleKey), description: resolve(error), color: 'error' })
  }

  return { resolve, toastError }
}
