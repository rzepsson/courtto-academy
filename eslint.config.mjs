// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt(
  // Standalone maintenance scripts (seed, etc.) run outside Nuxt via tsx and
  // legitimately use console output — keep them out of the app lint surface.
  { ignores: ['scripts/**'] }
)
