import type { Organization } from '~~/server/database/types'

export function useOrganizations() {
  return useFetch<Organization[]>('/api/organization', {
    key: 'organizations'
  })
}
