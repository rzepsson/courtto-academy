import { asc, eq } from 'drizzle-orm'
import { organization } from '../../database/schema'
import type { Organization } from '../../database/types'

export async function listOrganizations(): Promise<Organization[]> {
  return db
    .select()
    .from(organization)
    .orderBy(asc(organization.createdAt))
}

export async function getOrganizationBySlug(slug: string): Promise<Organization | null> {
  const [org] = await db
    .select()
    .from(organization)
    .where(eq(organization.slug, slug))
    .limit(1)

  return org ?? null
}
