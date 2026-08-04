// Scheduled job (wired in nuxt.config.ts `nitro.scheduledTasks`) that reminds the
// enrolled students (+ their guardians) of every lesson coming up in the next
// ~24h, in-app and by email. Runs hourly; the per-(session, student) dedupe key
// makes overlapping windows harmless, so a lesson is reminded exactly once. All
// the work — tenant scoping, idempotency, the per-run cap and per-session error
// isolation — lives in the service (runLessonReminderSweep); this is a thin driver
// that logs the outcome. `runLessonReminderSweep` and `defineTask` are Nitro
// auto-imports (same as the service calls in server/api/*).
export default defineTask({
  meta: {
    name: 'schedule:reminders',
    description: 'Remind enrolled students (and guardians) of lessons in the next ~24 hours.'
  },
  async run() {
    const result = await runLessonReminderSweep()
    console.info(`[schedule:reminders] scanned=${result.scanned} reminded=${result.reminded}`)
    return { result }
  }
})
