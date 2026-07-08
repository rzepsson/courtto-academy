import { randomUUID } from 'node:crypto'
import { AREA_ROLES } from '../../../shared/permissions'

// Allowed logo formats. SVG is intentionally excluded — it can carry scripts,
// and serving it from the storage origin isn't worth the risk here.
const ALLOWED_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp'
}
const MAX_BYTES = 2 * 1024 * 1024 // 2 MB

// Uploads a logo image to object storage and returns its public URL. It does
// NOT persist the URL on the organization — the client sets it via
// `authClient.organization.update` (rule 4: org mutations go through Better
// Auth), the same path the rest of the General section uses.
export default defineEventHandler(async (event) => {
  const { membership } = await requireActiveMembership(event, AREA_ROLES.school)

  if (!isStorageConfigured()) {
    throw createError({ statusCode: 503, statusMessage: 'Object storage is not configured' })
  }

  const form = await readMultipartFormData(event)
  const file = form?.find(part => part.name === 'file' && part.filename)

  if (!file) {
    throw createError({ statusCode: 400, statusMessage: 'No file uploaded' })
  }

  const ext = file.type ? ALLOWED_TYPES[file.type] : undefined
  if (!ext) {
    throw createError({ statusCode: 415, statusMessage: 'Unsupported image type' })
  }

  if (file.data.length > MAX_BYTES) {
    throw createError({ statusCode: 413, statusMessage: 'File too large' })
  }

  const key = `logos/${membership.organization.id}/${randomUUID()}.${ext}`
  const url = await uploadPublicObject(key, file.data, file.type!)

  return { url }
})
