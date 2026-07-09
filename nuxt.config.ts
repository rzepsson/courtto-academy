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
  nitro: {
    experimental: {
      websocket: true
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
