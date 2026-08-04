export default defineNuxtConfig({
  modules: ['@nuxt/eslint', '@nuxt/fonts', '@nuxt/ui', '@nuxtjs/i18n', 'motion-v/nuxt'],

  devtools: {
    enabled: true
  },

  app: {
    // No global page transition: `mode: 'out-in'` drops the incoming page's
    // content when the target has async `setup` (Suspense) — which every
    // dashboard page does — so client-side nav rendered a blank panel until a
    // hard refresh. Instant navigation is also the right feel for an app shell.
    pageTransition: false,
    layoutTransition: false
  },

  css: ['~/assets/css/main.css'],

  routeRules: {
    '/': { redirect: '/login' }
  },

  compatibilityDate: '2025-01-15',

  // Nitro's built-in WebSocket (crossws) powers the live notification channel at
  // /api/notifications/ws. Enhancement only — the REST feed stays authoritative.
  // `tasks` enables the scheduled job runner:
  //  - schedule:materialize (nightly 03:15) rolls every recurring lesson series'
  //    materialization horizon forward so "every Monday 17:00" never runs out of
  //    concrete sessions (see server/utils/services/schedule.ts).
  //  - schedule:reminders (hourly) reminds enrolled students + guardians of lessons
  //    in the next ~24h; idempotent per (session, student) so hourly is safe (see
  //    server/utils/services/lessonNotifications.ts).
  // Both sweeps are idempotent and bounded.
  nitro: {
    experimental: {
      websocket: true,
      tasks: true
    },
    scheduledTasks: {
      '15 3 * * *': ['schedule:materialize'],
      '0 * * * *': ['schedule:reminders']
    }
  },

  eslint: {
    config: {
      stylistic: {
        commaDangle: 'never',
        braceStyle: '1tbs'
      }
    }
  },

  i18n: {
    defaultLocale: 'en',
    strategy: 'no_prefix',
    locales: [
      { code: 'en', name: 'English', file: 'en.json' },
      { code: 'pl', name: 'Polski', file: 'pl.json' }
    ],
    detectBrowserLanguage: {
      useCookie: true,
      cookieKey: 'courtto_locale',
      redirectOn: 'root'
    }
  }
})
