// Scheduled job (wired in nuxt.config.ts `nitro.scheduledTasks`) that rolls every
// active recurring series' materialization horizon forward, so "every Monday
// 17:00" keeps producing concrete sessions instead of silently running out at the
// creation-time horizon. All the work — tenant scoping, idempotency, conflict
// skips, the per-run cap and the in-process reentrancy guard — lives in the
// service (runMaterializationSweep); the task is a thin driver that just logs the
// outcome. `runMaterializationSweep` and `defineTask` are Nitro auto-imports
// (same as the service calls in server/api/*).
export default defineTask({
  meta: {
    name: 'schedule:materialize',
    description: 'Roll every active recurring lesson series’ materialization horizon forward.'
  },
  async run() {
    const result = await runMaterializationSweep()
    if (result.status === 'busy') {
      console.info('[schedule:materialize] skipped — a sweep is already in progress')
    } else {
      console.info(
        `[schedule:materialize] processed=${result.processed} created=${result.created} `
        + `skipped=${result.skipped} failed=${result.failed}${result.capped ? ' capped' : ''}`
      )
    }
    return { result }
  }
})
