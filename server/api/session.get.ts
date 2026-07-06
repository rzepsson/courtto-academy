// Wrapped in an object: a bare null body becomes an empty response,
// which useFetch reads as undefined and warns about duplicated requests.
export default defineEventHandler(async event => ({
  session: await getUserSession(event)
}))
