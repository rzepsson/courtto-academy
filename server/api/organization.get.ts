export default defineEventHandler(async (event) => {
  await requireUserSession(event)

  const { slug } = getQuery(event)

  if (typeof slug === 'string' && slug.length > 0) {
    const org = await getOrganizationBySlug(slug)

    if (!org) {
      throw createError({ statusCode: 404, statusMessage: 'Organization not found' })
    }

    return org
  }

  return listOrganizations()
})
