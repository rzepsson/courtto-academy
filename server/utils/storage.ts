import { env } from 'node:process'
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'

// S3-compatible object storage (Cloudflare R2 / AWS S3 / MinIO). Config is
// entirely env-driven so the same code targets any provider:
//   S3_ENDPOINT           https://<account>.r2.cloudflarestorage.com
//   S3_REGION             'auto' for R2, e.g. 'eu-central-1' for AWS
//   S3_ACCESS_KEY_ID      / S3_SECRET_ACCESS_KEY
//   S3_BUCKET             target bucket
//   S3_PUBLIC_URL         public base URL objects are served from (R2 public
//                         bucket URL or a CDN/custom domain), no trailing slash
//   S3_FORCE_PATH_STYLE   'true' for MinIO (path-style addressing)
//
// Nothing is read at import time — the client is created lazily so the dev
// server still boots without storage configured; only an actual upload errors.

interface StorageConfig {
  endpoint: string
  region: string
  accessKeyId: string
  secretAccessKey: string
  bucket: string
  publicUrl: string
  forcePathStyle: boolean
}

function readConfig(): StorageConfig | null {
  const endpoint = env.S3_ENDPOINT
  const accessKeyId = env.S3_ACCESS_KEY_ID
  const secretAccessKey = env.S3_SECRET_ACCESS_KEY
  const bucket = env.S3_BUCKET
  const publicUrl = env.S3_PUBLIC_URL

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) {
    return null
  }

  return {
    endpoint,
    region: env.S3_REGION || 'auto',
    accessKeyId,
    secretAccessKey,
    bucket,
    publicUrl: publicUrl.replace(/\/+$/, ''),
    forcePathStyle: env.S3_FORCE_PATH_STYLE === 'true'
  }
}

let cached: { client: S3Client, config: StorageConfig } | null = null

function getStorage(): { client: S3Client, config: StorageConfig } | null {
  if (cached) {
    return cached
  }

  const config = readConfig()
  if (!config) {
    return null
  }

  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey
    }
  })

  cached = { client, config }
  return cached
}

export function isStorageConfigured(): boolean {
  return readConfig() !== null
}

// Uploads bytes under `key` and returns the public URL the object is served
// from. Objects are written with a long-lived cache header; callers give each
// upload a unique key (so a new logo gets a fresh URL and never serves stale).
export async function uploadPublicObject(
  key: string,
  body: Uint8Array,
  contentType: string
): Promise<string> {
  const storage = getStorage()
  if (!storage) {
    throw createError({ statusCode: 503, statusMessage: 'Object storage is not configured' })
  }

  await storage.client.send(new PutObjectCommand({
    Bucket: storage.config.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    CacheControl: 'public, max-age=31536000, immutable'
  }))

  return `${storage.config.publicUrl}/${key}`
}
