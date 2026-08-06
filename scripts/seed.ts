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
// The occurrence of a weekday `weeks` back. Recurring series start in the PAST so
// the current week is already full and the occupancy heatmap has history; a series
// starting "next Monday" leaves the demo looking empty for up to a week.
function weekdayWeeksAgo(target: number, weeks: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() - target + 7) % 7) - weeks * 7)
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
  const { recordAudit } = await import('../server/utils/services/audit')

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
    const adminMember = await addStaffOrStudent(orgId, admin.userId, 'admin')
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
    const kort2 = await createCourt(orgId, { name: 'Kort 2', sport: 'tennis', surface: 'clay', environment: 'indoor', zoneId: hala.id }, owner.userId)
    const kort3 = await createCourt(orgId, { name: 'Kort 3', sport: 'tennis', surface: 'clay', environment: 'outdoor', zoneId: null }, owner.userId)
    const padelA = await createCourt(orgId, { name: 'Padel A', sport: 'padel', surface: 'artificialGrass', environment: 'indoor', zoneId: padelZone.id }, owner.userId)
    const padelB = await createCourt(orgId, { name: 'Padel B', sport: 'padel', surface: 'artificialGrass', environment: 'indoor', zoneId: padelZone.id }, owner.userId)

    // ── The weekly timetable ────────────────────────────────────────────────
    // A real academy runs several lessons a day, so the demo does too: an empty
    // calendar makes a working product look broken. Series start WEEKS_BACK weeks
    // ago, which fills the current week from the moment you sign in and gives the
    // occupancy heatmap real history to plot.
    //
    // Slots are laid out so no court and no coach is ever double-booked. That is
    // not a style preference: the schedule service enforces both with Postgres
    // EXCLUDE constraints, so an overlap here fails the seed instead of passing
    // silently. Adjacent slots (one ends exactly where the next starts) are fine —
    // reservation ranges are half-open.
    const WEEKS_BACK = 3
    const DAY_CODE: Record<number, string> = { 0: 'SU', 1: 'MO', 2: 'TU', 3: 'WE', 4: 'TH', 5: 'FR', 6: 'SA' }
    const [MO, TU, WE, TH, FR, SA] = [1, 2, 3, 4, 5, 6]

    const kids = [kacperMember, lenaMember, antoniMember]
    const adults = [janMember, zofiaMember]

    interface Slot {
      day: number
      hour: number
      min?: number
      durationMin: number
      courtId: string
      coachMemberId: string
      sport: 'tennis' | 'padel'
      title: string
      type: 'group' | 'individual'
      capacityMax: number
      level?: string
      ageGroup?: string
      enroll?: string[]
    }

    const timetable: Slot[] = [
      // Monday
      { day: MO, hour: 9, durationMin: 60, courtId: kort1.id, coachMemberId: coach1Member, sport: 'tennis', title: 'Poranny trening — dorośli', type: 'group', capacityMax: 4, level: 'Średniozaawansowany', enroll: adults },
      { day: MO, hour: 10, min: 30, durationMin: 60, courtId: kort1.id, coachMemberId: coach1Member, sport: 'tennis', title: 'Trening indywidualny — Zofia', type: 'individual', capacityMax: 1 },
      { day: MO, hour: 16, durationMin: 60, courtId: kort2.id, coachMemberId: coach2Member, sport: 'tennis', title: 'Grupa dziecięca — starsi', type: 'group', capacityMax: 6, ageGroup: '10–14', enroll: [antoniMember] },
      { day: MO, hour: 17, durationMin: 60, courtId: kort1.id, coachMemberId: coach1Member, sport: 'tennis', title: 'Grupa dziecięca — poniedziałki', type: 'group', capacityMax: 4, level: 'Początkujący', ageGroup: '8–12', enroll: kids },
      { day: MO, hour: 17, min: 30, durationMin: 90, courtId: padelA.id, coachMemberId: coach2Member, sport: 'padel', title: 'Padel — poniedziałki', type: 'group', capacityMax: 4, enroll: adults },
      { day: MO, hour: 18, min: 30, durationMin: 90, courtId: kort2.id, coachMemberId: ownerMemberId, sport: 'tennis', title: 'Grupa zaawansowana', type: 'group', capacityMax: 4, level: 'Zaawansowany' },

      // Tuesday
      { day: TU, hour: 9, durationMin: 90, courtId: kort2.id, coachMemberId: coach2Member, sport: 'tennis', title: 'Tenis dla seniorów', type: 'group', capacityMax: 6 },
      { day: TU, hour: 11, durationMin: 60, courtId: kort1.id, coachMemberId: coach1Member, sport: 'tennis', title: 'Trening indywidualny — Jan', type: 'individual', capacityMax: 1 },
      { day: TU, hour: 16, durationMin: 60, courtId: kort1.id, coachMemberId: coach1Member, sport: 'tennis', title: 'Grupa dziecięca — młodsi', type: 'group', capacityMax: 6, ageGroup: '6–9', enroll: [kacperMember, lenaMember] },
      { day: TU, hour: 17, durationMin: 90, courtId: padelA.id, coachMemberId: coach2Member, sport: 'padel', title: 'Padel — średniozaawansowani', type: 'group', capacityMax: 4, enroll: [janMember] },
      { day: TU, hour: 18, durationMin: 60, courtId: kort3.id, coachMemberId: ownerMemberId, sport: 'tennis', title: 'Tenis wieczorny — korty otwarte', type: 'group', capacityMax: 4 },
      { day: TU, hour: 19, durationMin: 60, courtId: kort1.id, coachMemberId: coach1Member, sport: 'tennis', title: 'Sparingi', type: 'group', capacityMax: 4, enroll: adults },

      // Wednesday
      { day: WE, hour: 9, min: 30, durationMin: 60, courtId: kort1.id, coachMemberId: coach1Member, sport: 'tennis', title: 'Poranny trening — dorośli', type: 'group', capacityMax: 4, enroll: [zofiaMember] },
      { day: WE, hour: 16, durationMin: 60, courtId: kort2.id, coachMemberId: coach2Member, sport: 'tennis', title: 'Grupa dziecięca — starsi', type: 'group', capacityMax: 6, ageGroup: '10–14', enroll: [antoniMember] },
      { day: WE, hour: 17, durationMin: 60, courtId: kort1.id, coachMemberId: coach1Member, sport: 'tennis', title: 'Grupa młodzieżowa', type: 'group', capacityMax: 6, ageGroup: '13–17' },
      { day: WE, hour: 18, durationMin: 60, courtId: kort3.id, coachMemberId: ownerMemberId, sport: 'tennis', title: 'Tenis wieczorny — korty otwarte', type: 'group', capacityMax: 4 },
      { day: WE, hour: 19, durationMin: 90, courtId: padelA.id, coachMemberId: coach2Member, sport: 'padel', title: 'Padel dorośli — środy', type: 'group', capacityMax: 4, level: 'Średniozaawansowany', enroll: adults },
      { day: WE, hour: 19, durationMin: 60, courtId: kort1.id, coachMemberId: coach1Member, sport: 'tennis', title: 'Trening indywidualny — Zofia', type: 'individual', capacityMax: 1 },

      // Thursday
      { day: TH, hour: 10, durationMin: 60, courtId: kort1.id, coachMemberId: coach1Member, sport: 'tennis', title: 'Trening indywidualny — Jan', type: 'individual', capacityMax: 1 },
      { day: TH, hour: 16, min: 30, durationMin: 60, courtId: kort2.id, coachMemberId: coach2Member, sport: 'tennis', title: 'Grupa dziecięca — młodsi', type: 'group', capacityMax: 6, ageGroup: '6–9', enroll: [kacperMember, lenaMember] },
      { day: TH, hour: 17, min: 30, durationMin: 90, courtId: padelB.id, coachMemberId: coach2Member, sport: 'padel', title: 'Padel — czwartki', type: 'group', capacityMax: 4, enroll: [zofiaMember] },
      { day: TH, hour: 18, durationMin: 60, courtId: kort1.id, coachMemberId: coach1Member, sport: 'tennis', title: 'Technika — dorośli', type: 'group', capacityMax: 4, enroll: [janMember] },
      { day: TH, hour: 19, durationMin: 60, courtId: kort3.id, coachMemberId: ownerMemberId, sport: 'tennis', title: 'Sparingi', type: 'group', capacityMax: 4 },

      // Friday
      { day: FR, hour: 9, durationMin: 60, courtId: kort1.id, coachMemberId: coach1Member, sport: 'tennis', title: 'Poranny trening — dorośli', type: 'group', capacityMax: 4, enroll: adults },
      { day: FR, hour: 10, durationMin: 60, courtId: kort3.id, coachMemberId: ownerMemberId, sport: 'tennis', title: 'Trening indywidualny', type: 'individual', capacityMax: 1 },
      { day: FR, hour: 16, durationMin: 60, courtId: kort2.id, coachMemberId: coach2Member, sport: 'tennis', title: 'Grupa dziecięca — starsi', type: 'group', capacityMax: 6, ageGroup: '10–14', enroll: [antoniMember] },
      { day: FR, hour: 17, durationMin: 90, courtId: padelA.id, coachMemberId: coach2Member, sport: 'padel', title: 'Padel — piątki', type: 'group', capacityMax: 4, enroll: adults },
      { day: FR, hour: 18, durationMin: 60, courtId: kort1.id, coachMemberId: coach1Member, sport: 'tennis', title: 'Grupa młodzieżowa', type: 'group', capacityMax: 6, ageGroup: '13–17' },

      // Saturday
      { day: SA, hour: 9, durationMin: 90, courtId: kort1.id, coachMemberId: coach1Member, sport: 'tennis', title: 'Sobotni camp — grupa I', type: 'group', capacityMax: 6, enroll: kids },
      { day: SA, hour: 9, durationMin: 90, courtId: padelA.id, coachMemberId: coach2Member, sport: 'padel', title: 'Padel weekendowy', type: 'group', capacityMax: 4, enroll: adults },
      { day: SA, hour: 10, min: 30, durationMin: 90, courtId: kort1.id, coachMemberId: coach1Member, sport: 'tennis', title: 'Sobotni camp — grupa II', type: 'group', capacityMax: 6 },
      { day: SA, hour: 11, durationMin: 60, courtId: kort2.id, coachMemberId: ownerMemberId, sport: 'tennis', title: 'Trening indywidualny', type: 'individual', capacityMax: 1 }
    ]

    for (const slot of timetable) {
      const lesson = await createLesson(orgId, {
        type: slot.type,
        sport: slot.sport,
        title: slot.title,
        ...(slot.level ? { level: slot.level } : {}),
        ...(slot.ageGroup ? { ageGroup: slot.ageGroup } : {}),
        capacityMax: slot.capacityMax,
        enrollmentOpen: slot.type === 'group',
        visibility: slot.type === 'group' ? 'members' : 'private',
        color: slot.sport === 'padel' ? '#1c9c6b' : '#2f6db5',
        rules: [{
          rrule: `FREQ=WEEKLY;BYDAY=${DAY_CODE[slot.day]}`,
          dtStart: at(weekdayWeeksAgo(slot.day, WEEKS_BACK), slot.hour, slot.min ?? 0),
          durationMin: slot.durationMin,
          courtId: slot.courtId,
          coachMemberId: slot.coachMemberId
        }]
      }, owner.userId)

      for (const student of slot.enroll ?? []) {
        await enrollInSeries(orgId, lesson.series.id, student, true)
      }
    }

    // Recurring series materialize forward from NOW, so however far back dtStart is
    // set the past stays empty — and an empty past means a blank occupancy heatmap
    // and zero lesson hours on the owner dashboard. Replay the same timetable as
    // one-off lessons over the preceding days to give the analytics real history.
    // No conflict checks to worry about: those days hold no reservations yet, and
    // each day's slots were already laid out not to clash with each other.
    const PAST_DAYS = 10
    let pastLessons = 0
    for (let back = 1; back <= PAST_DAYS; back++) {
      const date = daysFromNow(-back)
      for (const slot of timetable.filter(s => s.day === date.getDay())) {
        await createLesson(orgId, {
          type: slot.type,
          sport: slot.sport,
          title: slot.title,
          capacityMax: slot.capacityMax,
          visibility: slot.type === 'group' ? 'members' : 'private',
          color: slot.sport === 'padel' ? '#1c9c6b' : '#2f6db5',
          rules: [{
            rrule: null,
            dtStart: at(date, slot.hour, slot.min ?? 0),
            durationMin: slot.durationMin,
            courtId: slot.courtId,
            coachMemberId: slot.coachMemberId
          }]
        }, owner.userId)
        pastLessons += 1
      }
    }

    // A one-off (rrule null) alongside the recurring series. Noon on Kort 3 is free
    // on every weekday in the timetable above, so "tomorrow" never collides.
    await createLesson(orgId, {
      type: 'individual', sport: 'tennis', title: 'Trening indywidualny — Jan',
      capacityMax: 1, visibility: 'private', color: '#b5532f',
      rules: [{ rrule: null, dtStart: at(daysFromNow(1), 12, 0), durationMin: 60, courtId: kort3.id, coachMemberId: coach1Member }]
    }, owner.userId)

    // The governance trail. These entries record what the seed itself just did, so
    // the activity feed reads as a real history rather than sitting empty.
    await recordAudit({ organizationId: orgId, action: 'member.role_changed', actorMemberId: ownerMemberId, targetMemberId: adminMember, data: { targetName: 'Piotr Nowak', role: 'admin' } })
    await recordAudit({ organizationId: orgId, action: 'member.coach_granted', actorMemberId: ownerMemberId, targetMemberId: ownerMemberId, data: { targetName: 'Anna Kowalska' } })
    await recordAudit({ organizationId: orgId, action: 'member.consent_granted', actorMemberId: ownerMemberId, targetMemberId: kacperMember, data: { targetName: 'Kacper Kowalczyk' } })
    await recordAudit({ organizationId: orgId, action: 'member.consent_granted', actorMemberId: ownerMemberId, targetMemberId: janMember, data: { targetName: 'Jan Lewandowski' } })

    console.log(`  ✓ ${school}: 9 members, 2 zones, 5 courts, ${timetable.length} weekly series + ${pastLessons} past lessons, enrolments + guardians + consents`)
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
      rules: [{ rrule: 'FREQ=WEEKLY;BYDAY=TH', dtStart: at(weekdayWeeksAgo(4, 3), 18, 0), durationMin: 60, courtId: court.id, coachMemberId: coachMember }]
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
