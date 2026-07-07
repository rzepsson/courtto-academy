import { createAuthClient } from 'better-auth/vue'
import { organizationClient } from 'better-auth/client/plugins'
import { ac, roles } from '~~/shared/permissions'

export const authClient = createAuthClient({
  plugins: [
    organizationClient({ ac, roles })
  ]
})
