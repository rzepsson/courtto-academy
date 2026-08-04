/**
 * Demo/seed data for courtto-academy.
 *
 * Populates the database with two schools and realistic domain data so the app
 * can be exercised end-to-end WITHOUT any external service (no Stripe / S3 / SMTP
 * — the app degrades gracefully when those are unset).
 *
 * HOW IT SEEDS (respecting the repo's non-negotiables):
 *   • Users, organizations and memberships go through `auth.api.*` (Better Auth
 *     owns those tables — CLAUDE.md rule 4), exactly like test/server/helpers.ts.
 *   • App-owned domain data (profile, courts, zones, schedule, enrolments,
 *     guardians, consents) goes through the real, tested SERVICES — so every
 *     invariant (conflict checks, capacity, DST-correct occurrence materialization,
 *     minor→guardian consent rule) is honoured, not re-implemented here.
 *
 * The services are Nuxt server utils that expect a few functions to be globally
 * available (Nitro auto-imports). Only `createError` is actually reached by the
 * code paths we call, so we polyfill it before importing anything. `db`/`auth`
 * are plain module-level singletons designed to load outside Nuxt.
 *
 * RUN:
 *   DATABASE_URL=postgres://... BETTER_AUTH_SECRET=... pnpm seed
 *
 * Idempotent per school: a school whose slug already exists is skipped, so
 * re-running against an already-seeded database is a safe no-op.
 */
import { env, exit } from 'node:process'

// Polyfill the one Nitro auto-import the services reach at runtime. h3's real
// `createError` isn't resolvable here (a transitive dep, not hoisted by pnpm),
// and the seed's happy path never triggers it anyway — this is a safety net that
// turns a service's validation `throw` into a readable Error instead of a crash.
interface HttpErrorInput { statusCode?: number, statusMessage?: string, data?: unknown }
;(globalThis as Record<string, unknown>).createError = (input: string | HttpErrorInput) => {
  const message = typeof input === 'string' ? input : input.statusMessage ?? 'Error'
  const err = new Error(message)
  if (typeof input === 'object') {
    Object.assign(err, input)
  }
  return err
}

const PASSWORD = 'courtto123'

if (!env.DATABASE_URL || !env.BETTER_AUTH_SECRET) {
  console.error('✗ Set DATABASE_URL and BETTER_AUTH_SECRET before seeding.')
  console.error('  e.g. DATABASE_URL=postgres://postgres:postgres@localhost:5433/courtto_seed BETTER_AUTH_SECRET=dev-secret pnpm seed')
  exit(1)
}

// ── date helpers (wall-clock local, 'YYYY-MM-DDTHH:mm') ──────────────────────
function pad(n: number): string {
  return String(n).padStart(2, '0')
}
function at(d: Date, hour: number, min = 0): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(hour)}:${pad(min)}`
}
// The next occurrence of a weekday (0=Sun..6=Sat), strictly in the future.
function nextWeekday(target: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  const diff = (target - d.getDay() + 7) % 7 || 7
  d.setDate(d.getDate() + diff)
  return d
}
function daysFromNow(n: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + n)
  return d
}

async function run() {
  // Dynamic imports AFTER the env guard so a missing DATABASE_URL fails with a
  // clear message instead of a driver stack trace from db.ts's import.
  const { auth } = await import('../server/utils/auth')
  const { db } = await import('../server/utils/db')
  const { organization, member, user } = await import('../server/database/schema')
  const { and, eq } = await import('drizzle-orm')

  const { upsertOrgProfile } = await import('../server/utils/services/orgProfile')
  const { createZone } = await import('../server/utils/services/courtZones')
  const { createCourt } = await import('../server/utils/services/courts')
  const { createLesson } = await import('../server/utils/services/schedule')
  const { enrollInSeries } = await import('../server/utils/services/enrollment')
  const { upsertMemberProfile } = await import('../server/utils/services/memberProfile')
  const { createMemberGuardian } = await import('../server/utils/services/memberGuardians')
  const { recordMemberConsent } = await import('../server/utils/services/memberConsents')

  type OrgRole = 'owner' | 'admin' | 'coach' | 'student'

  function cookieOf(headers: Headers): string {
    return headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
  }

  // Sign a user up (or sign them in if they already exist) and resolve their id
  // from the user table — robust across Better Auth response shapes.
  async function ensureAuth(name: string, email: string): Promise<{ userId: string, email: string, headers: Headers }> {
    let setCookie = ''
    try {
      const { headers } = await auth.api.signUpEmail({ body: { name, email, password: PASSWORD }, returnHeaders: true })
      setCookie = cookieOf(headers)
    } catch {
      const { headers } = await auth.api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true })
      setCookie = cookieOf(headers)
    }
    const [row] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1)
    if (!row) throw new Error(`user not found after auth: ${email}`)
    return { userId: row.id, email, headers: new Headers({ cookie: setCookie }) }
  }

  async function memberIdOf(orgId: string, userId: string): Promise<string> {
    const [row] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
      .limit(1)
    if (!row) throw new Error(`membership not found (org ${orgId}, user ${userId})`)
    return row.id
  }

  async function addStaffOrStudent(orgId: string, userId: string, role: OrgRole): Promise<string> {
    await auth.api.addMember({ body: { userId, organizationId: orgId, role } })
    return memberIdOf(orgId, userId)
  }

  async function slugExists(slug: string): Promise<boolean> {
    const [row] = await db.select({ id: organization.id }).from(organization).where(eq(organization.slug, slug)).limit(1)
    return Boolean(row)
  }

  const credentials: { school: string, role: string, name: string, email: string }[] = []
  function cred(school: string, role: string, name: string, email: string) {
    credentials.push({ school, role, name, email })
  }

  // ── School 1: Akademia Tenisa Warszawa (rich dataset) ──────────────────────
  async function seedWarszawa() {
    const slug = 'warszawa-tenis'
    const school = 'Akademia Tenisa Warszawa'
    if (await slugExists(slug)) {
      console.log(`• ${school}: already seeded — skipping`)
      return
    }
    console.log(`• ${school}: seeding…`)

    // Owner (also teaches) creates the org → becomes owner automatically.
    const owner = await ensureAuth('Anna Kowalska', 'anna@warszawa-tenis.pl')
    const org = await auth.api.createOrganization({ body: { name: school, slug }, headers: owner.headers })
    if (!org) throw new Error('createOrganization returned null')
    const orgId = org.id
    const ownerMemberId = await memberIdOf(orgId, owner.userId)
    cred(school, 'owner', 'Anna Kowalska', owner.email)

    // Full profile → the school reads as "ready" (contactEmail + sports + city +
    // country are the REQUIRED_PROFILE_FIELDS), so the setup checklist clears.
    await upsertOrgProfile(orgId, {
      contactEmail: 'kontakt@warszawa-tenis.pl',
      contactPhone: '+48 22 123 45 67',
      sports: ['tennis', 'padel'],
      city: 'Warszawa',
      country: 'PL',
      addressLine1: 'ul. Sportowa 12',
      postalCode: '00-001',
      timezone: 'Europe/Warsaw',
      locale: 'pl',
      currency: 'PLN',
      legalName: 'Akademia Tenisa Warszawa Sp. z o.o.',
      taxId: '5213456789',
      description: 'Szkoła tenisa i padla w sercu Warszawy.'
    })

    // Owner also coaches — grant the capability (orthogonal to the governance role).
    await upsertMemberProfile(orgId, ownerMemberId, { canCoach: true })

    // Staff
    const admin = await ensureAuth('Piotr Nowak', 'piotr@warszawa-tenis.pl')
    await addStaffOrStudent(orgId, admin.userId, 'admin')
    cred(school, 'admin', 'Piotr Nowak', admin.email)

    const coach1 = await ensureAuth('Marek Wiśniewski', 'marek@warszawa-tenis.pl')
    const coach1Member = await addStaffOrStudent(orgId, coach1.userId, 'coach')
    cred(school, 'coach', 'Marek Wiśniewski', coach1.email)

    const coach2 = await ensureAuth('Katarzyna Zielińska', 'katarzyna@warszawa-tenis.pl')
    const coach2Member = await addStaffOrStudent(orgId, coach2.userId, 'coach')
    cred(school, 'coach', 'Katarzyna Zielińska', coach2.email)

    // Students — adults
    const jan = await ensureAuth('Jan Lewandowski', 'jan@example.com')
    const janMember = await addStaffOrStudent(orgId, jan.userId, 'student')
    await upsertMemberProfile(orgId, janMember, { dateOfBirth: '1992-04-18' })
    cred(school, 'student', 'Jan Lewandowski', jan.email)

    const zofia = await ensureAuth('Zofia Wójcik', 'zofia@example.com')
    const zofiaMember = await addStaffOrStudent(orgId, zofia.userId, 'student')
    await upsertMemberProfile(orgId, zofiaMember, { dateOfBirth: '1988-11-30' })
    cred(school, 'student', 'Zofia Wójcik', zofia.email)

    // Students — minors (drive the compliance report)
    const kacper = await ensureAuth('Kacper Kowalczyk', 'kacper@example.com')
    const kacperMember = await addStaffOrStudent(orgId, kacper.userId, 'student')
    await upsertMemberProfile(orgId, kacperMember, { dateOfBirth: '2015-06-15' })
    cred(school, 'student (minor)', 'Kacper Kowalczyk', kacper.email)

    const lena = await ensureAuth('Lena Kamińska', 'lena@example.com')
    const lenaMember = await addStaffOrStudent(orgId, lena.userId, 'student')
    await upsertMemberProfile(orgId, lenaMember, { dateOfBirth: '2017-03-20' })
    cred(school, 'student (minor)', 'Lena Kamińska', lena.email)

    const antoni = await ensureAuth('Antoni Zając', 'antoni@example.com')
    const antoniMember = await addStaffOrStudent(orgId, antoni.userId, 'student')
    await upsertMemberProfile(orgId, antoniMember, { dateOfBirth: '2010-09-01' })
    cred(school, 'student (minor)', 'Antoni Zając', antoni.email)

    // Guardians (PII of minors). Kacper + Lena have one; Antoni deliberately has
    // NONE → a "needs guardian" compliance gap.
    const kacperGuardian = await createMemberGuardian(orgId, kacperMember, {
      name: 'Ewa Kowalczyk', relationship: 'mother', phone: '+48 601 234 567', email: 'ewa.kowalczyk@example.com', isPrimary: true, notes: ''
    })
    await createMemberGuardian(orgId, lenaMember, {
      name: 'Tomasz Kamiński', relationship: 'father', phone: '+48 602 345 678', email: '', isPrimary: true, notes: ''
    })

    // Consents (RODO). Kacper's image consent granted BY his guardian; Jan (adult)
    // grants his own. Lena + Antoni + Zofia are left "never asked" → image-consent
    // gaps in the compliance report.
    if (kacperGuardian) {
      await recordMemberConsent(orgId, kacperMember, 'image', { status: 'granted', guardianId: kacperGuardian.id, documentVersion: 'v1.0', notes: '' }, ownerMemberId)
    }
    await recordMemberConsent(orgId, janMember, 'image', { status: 'granted', guardianId: null, documentVersion: 'v1.0', notes: '' }, ownerMemberId)

    // Zones + courts
    const hala = await createZone(orgId, { name: 'Hala główna' }, owner.userId)
    const padelZone = await createZone(orgId, { name: 'Korty padla' }, owner.userId)

    const kort1 = await createCourt(orgId, { name: 'Kort 1', sport: 'tennis', surface: 'hard', environment: 'indoor', zoneId: hala.id }, owner.userId)
    await createCourt(orgId, { name: 'Kort 2', sport: 'tennis', surface: 'clay', environment: 'indoor', zoneId: hala.id }, owner.userId)
    const kort3 = await createCourt(orgId, { name: 'Kort 3', sport: 'tennis', surface: 'clay', environment: 'outdoor', zoneId: null }, owner.userId)
    const padelA = await createCourt(orgId, { name: 'Padel A', sport: 'padel', surface: 'artificialGrass', environment: 'indoor', zoneId: padelZone.id }, owner.userId)
    const padelB = await createCourt(orgId, { name: 'Padel B', sport: 'padel', surface: 'artificialGrass', environment: 'indoor', zoneId: padelZone.id }, owner.userId)

    // Recurring group: kids' tennis, Mondays 17:00, Kort 1, coach Marek.
    const kidsGroup = await createLesson(orgId, {
      type: 'group', sport: 'tennis', title: 'Grupa dziecięca — poniedziałki',
      level: 'Początkujący', ageGroup: '8–12', capacityMin: 2, capacityMax: 4,
      enrollmentOpen: true, visibility: 'members', color: '#2f6db5',
      rules: [{ rrule: 'FREQ=WEEKLY;BYDAY=MO', dtStart: at(nextWeekday(1), 17, 0), durationMin: 60, courtId: kort1.id, coachMemberId: coach1Member }]
    }, owner.userId)
    await enrollInSeries(orgId, kidsGroup.series.id, kacperMember, true)
    await enrollInSeries(orgId, kidsGroup.series.id, lenaMember, true)
    await enrollInSeries(orgId, kidsGroup.series.id, antoniMember, true)

    // Recurring group: adult padel, Wednesdays 19:00, Padel A, coach Katarzyna.
    const padelGroup = await createLesson(orgId, {
      type: 'group', sport: 'padel', title: 'Padel dorośli — środy',
      level: 'Średniozaawansowany', capacityMin: 2, capacityMax: 4,
      enrollmentOpen: true, visibility: 'members', color: '#1c9c6b',
      rules: [{ rrule: 'FREQ=WEEKLY;BYDAY=WE', dtStart: at(nextWeekday(3), 19, 0), durationMin: 90, courtId: padelA.id, coachMemberId: coach2Member }]
    }, owner.userId)
    await enrollInSeries(orgId, padelGroup.series.id, janMember, true)
    await enrollInSeries(orgId, padelGroup.series.id, zofiaMember, true)

    // One-off individual lesson tomorrow 10:00, Kort 2, coach Marek.
    await createLesson(orgId, {
      type: 'individual', sport: 'tennis', title: 'Trening indywidualny — Jan',
      capacityMax: 1, visibility: 'private', color: '#b5532f',
      rules: [{ rrule: null, dtStart: at(daysFromNow(1), 10, 0), durationMin: 60, courtId: kort3.id, coachMemberId: coach1Member }]
    }, owner.userId)

    // A couple of PAST one-off lessons so the occupancy heatmap / recent activity
    // on the owner dashboard show real usage.
    await createLesson(orgId, {
      type: 'individual', sport: 'tennis', title: 'Trening — wczoraj',
      capacityMax: 1, visibility: 'private', color: '#b5532f',
      rules: [{ rrule: null, dtStart: at(daysFromNow(-1), 18, 0), durationMin: 60, courtId: kort3.id, coachMemberId: coach1Member }]
    }, owner.userId)
    await createLesson(orgId, {
      type: 'group', sport: 'padel', title: 'Padel — 2 dni temu',
      capacityMax: 4, visibility: 'members', color: '#1c9c6b',
      rules: [{ rrule: null, dtStart: at(daysFromNow(-2), 17, 0), durationMin: 90, courtId: padelB.id, coachMemberId: coach2Member }]
    }, owner.userId)

    console.log(`  ✓ ${school}: 9 members, 2 zones, 5 courts, 5 lessons, enrolments + guardians + consents`)
  }

  // ── School 2: Padel Club Kraków (minimal — proves multi-tenant isolation) ──
  async function seedKrakow() {
    const slug = 'krakow-padel'
    const school = 'Padel Club Kraków'
    if (await slugExists(slug)) {
      console.log(`• ${school}: already seeded — skipping`)
      return
    }
    console.log(`• ${school}: seeding…`)

    const owner = await ensureAuth('Grzegorz Mazur', 'grzegorz@krakow-padel.pl')
    const org = await auth.api.createOrganization({ body: { name: school, slug }, headers: owner.headers })
    if (!org) throw new Error('createOrganization returned null')
    const orgId = org.id
    cred(school, 'owner', 'Grzegorz Mazur', owner.email)

    await upsertOrgProfile(orgId, {
      contactEmail: 'kontakt@krakow-padel.pl',
      sports: ['padel'],
      city: 'Kraków',
      country: 'PL',
      timezone: 'Europe/Warsaw',
      locale: 'pl',
      currency: 'PLN'
    })

    const coach = await ensureAuth('Ola Dąbrowska', 'ola@krakow-padel.pl')
    const coachMember = await addStaffOrStudent(orgId, coach.userId, 'coach')
    cred(school, 'coach', 'Ola Dąbrowska', coach.email)

    const student = await ensureAuth('Bartek Nowicki', 'bartek@example.com')
    const studentMember = await addStaffOrStudent(orgId, student.userId, 'student')
    cred(school, 'student', 'Bartek Nowicki', student.email)

    const court = await createCourt(orgId, { name: 'Kort 1', sport: 'padel', surface: 'porous', environment: 'covered', zoneId: null }, owner.userId)
    await createCourt(orgId, { name: 'Kort 2', sport: 'padel', surface: 'artificialGrass', environment: 'covered', zoneId: null }, owner.userId)

    const group = await createLesson(orgId, {
      type: 'group', sport: 'padel', title: 'Padel — czwartki',
      capacityMin: 2, capacityMax: 4, enrollmentOpen: true, visibility: 'members',
      rules: [{ rrule: 'FREQ=WEEKLY;BYDAY=TH', dtStart: at(nextWeekday(4), 18, 0), durationMin: 60, courtId: court.id, coachMemberId: coachMember }]
    }, owner.userId)
    await enrollInSeries(orgId, group.series.id, studentMember, true)

    console.log(`  ✓ ${school}: 3 members, 2 courts, 1 lesson, enrolment`)
  }

  console.log('\nSeeding courtto-academy demo data…\n')
  await seedWarszawa()
  await seedKrakow()

  if (credentials.length > 0) {
    console.log(`\nLogin credentials (password for ALL: ${PASSWORD}):\n`)
    console.log('  School'.padEnd(28) + 'Role'.padEnd(18) + 'Email')
    console.log('  ' + '─'.repeat(70))
    for (const c of credentials) {
      console.log('  ' + c.school.padEnd(26) + c.role.padEnd(18) + c.email)
    }
  }

  console.log('\n✓ Seed complete.\n')
  await db.$client.end().catch(() => {})
  exit(0)
}

run().catch((error) => {
  console.error('\n✗ Seed failed:', error)
  exit(1)
})
