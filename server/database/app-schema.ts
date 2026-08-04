import { relations, sql } from 'drizzle-orm'
import { pgTable, text, timestamp, boolean, date, integer, jsonb, index, uniqueIndex, check } from 'drizzle-orm/pg-core'
import { organization, user, member } from './schema'

// App-owned tables live here, NOT in schema.ts — that file is regenerated (and
// fully overwritten) by `pnpm auth:generate`, which only knows about Better
// Auth's tables. Both files are wired into db.ts and drizzle.config.ts.
//
// Unlike the Better Auth tables (rule 4: read-only via services, mutate through
// auth.api.*), this table is ours: services write to it with Drizzle directly.

// One rotatable self-service join code per organization (organizationId is the
// PK, so there is at most one row). Students redeem it to join as `student`;
// privileged roles still go through personal email invitations.
export const orgJoinCode = pgTable(
  'org_join_code',
  {
    organizationId: text('organization_id')
      .primaryKey()
      .references(() => organization.id, { onDelete: 'cascade' }),
    code: text('code').notNull().unique(),
    // Lets a school pause self-enrollment without discarding the code — toggling
    // off blocks redemption (preview + join 404) but keeps the same code so it
    // still works when switched back on.
    enabled: boolean('enabled').default(true).notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    // Kept for audit; nulled rather than cascade-deleted if the creator leaves,
    // so rotating the code never depends on the original author still existing.
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' })
  },
  table => [index('org_join_code_code_idx').on(table.code)]
)

export const orgJoinCodeRelations = relations(orgJoinCode, ({ one }) => ({
  organization: one(organization, {
    fields: [orgJoinCode.organizationId],
    references: [organization.id]
  })
}))

// The school's Stripe Connect (Express) account — how the school collects lesson
// fees from parents (the school is the merchant of record; Courtto is the
// platform). CORE, product-neutral: the future Courtto marketplace collects
// court-booking fees through the SAME account. One row per org (PK =
// organizationId). The `*Enabled`/`detailsSubmitted` flags MIRROR Stripe (kept
// fresh by the Connect webhook + on-demand sync) — Stripe is the source of truth;
// readiness is DERIVED from them (shared/payments.ts), never a stored boolean.
export const orgPaymentAccount = pgTable(
  'org_payment_account',
  {
    organizationId: text('organization_id')
      .primaryKey()
      .references(() => organization.id, { onDelete: 'cascade' }),
    // The Stripe connected-account id (acct_…). Every direct charge / subscription
    // for this school is created against it (Stripe-Account header).
    stripeAccountId: text('stripe_account_id').notNull().unique(),
    chargesEnabled: boolean('charges_enabled').default(false).notNull(),
    payoutsEnabled: boolean('payouts_enabled').default(false).notNull(),
    detailsSubmitted: boolean('details_submitted').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  table => [uniqueIndex('org_payment_account_stripe_idx').on(table.stripeAccountId)]
)

export const orgPaymentAccountRelations = relations(orgPaymentAccount, ({ one }) => ({
  organization: one(organization, {
    fields: [orgPaymentAccount.organizationId],
    references: [organization.id]
  })
}))

// A reusable monthly pricing plan a school defines (e.g. "Junior 1×/week — 200 zł").
// ACADEMY (it prices lessons); a group (lessonSeries) references one. Mirrored as a
// Stripe Product + recurring Price ON THE SCHOOL'S CONNECTED ACCOUNT (direct charges
// → the school is the merchant). `amountMinor` is INTEGER minor units (grosze),
// never a float; `currency` is snapshotted from the school's profile at creation
// (a Stripe Price is immutable, so changing the amount creates a NEW price — the old
// one is deactivated and existing subscriptions keep it). `archivedAt` is the
// lifecycle axis (soft-delete — a plan tied to subscriptions must keep its history).
export const pricingPlan = pgTable(
  'pricing_plan',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    description: text('description'),
    amountMinor: integer('amount_minor').notNull(),
    currency: text('currency').notNull(),
    // Stripe object ids on the connected account (nullable only transiently before
    // they're created; the service always sets them on insert).
    stripeProductId: text('stripe_product_id'),
    stripePriceId: text('stripe_price_id'),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' })
  },
  table => [index('pricing_plan_org_idx').on(table.organizationId)]
)

export const pricingPlanRelations = relations(pricingPlan, ({ one }) => ({
  organization: one(organization, {
    fields: [pricingPlan.organizationId],
    references: [organization.id]
  })
}))

// Extended school profile (contact, address, regional & business details) that
// Better Auth's `organization` table doesn't model. One row per org (PK =
// organizationId). Kept out of the auth table on purpose: this is app-domain
// data, we don't want to bloat every get-session/get-full-organization payload,
// and it grows independently of `pnpm auth:generate`. Owner/admin fill it in
// later from school settings — not during onboarding. `name`, `slug` and `logo`
// stay on `organization` (edited via Better Auth); everything else lives here.
export const orgProfile = pgTable('org_profile', {
  organizationId: text('organization_id')
    .primaryKey()
    .references(() => organization.id, { onDelete: 'cascade' }),

  // Public profile / marketing
  description: text('description'),
  // Which racket sports the school offers (e.g. ['tennis', 'padel']); drives
  // terminology across the app. Stored as a Postgres text[].
  sports: text('sports').array(),

  // Contact — public-facing and the reply-to identity for future notifications.
  contactEmail: text('contact_email'),
  contactPhone: text('contact_phone'),
  websiteUrl: text('website_url'),
  instagramUrl: text('instagram_url'),
  facebookUrl: text('facebook_url'),

  // Location / address
  addressLine1: text('address_line1'),
  addressLine2: text('address_line2'),
  city: text('city'),
  postalCode: text('postal_code'),
  country: text('country'), // ISO 3166-1 alpha-2

  // Regional / operational — critical for scheduling & notification timing.
  timezone: text('timezone'), // IANA, e.g. 'Europe/Warsaw'
  locale: text('locale'), // default notification language, 'pl' | 'en'
  currency: text('currency'), // ISO 4217, e.g. 'PLN' — future billing

  // Business / legal — for future invoicing.
  legalName: text('legal_name'),
  taxId: text('tax_id'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull()
})

export const orgProfileRelations = relations(orgProfile, ({ one }) => ({
  organization: one(organization, {
    fields: [orgProfile.organizationId],
    references: [organization.id]
  })
}))

// Extended, app-owned membership metadata that Better Auth's `member` table
// doesn't model — the sidecar to `member`, exactly as `orgProfile` is to
// `organization`. One row per membership (PK = memberId). CORE / product-neutral:
// governance (status), a capability seam (canCoach), and staff-side CRM fields
// (internal notes, labels). Kept off the auth table on purpose: `member` is
// Better-Auth-owned + regenerated by `pnpm auth:generate`, and this data must
// not bloat every get-session / get-full-organization payload.
//
// Absence of a row = the column defaults (status 'active', canCoach false, no
// notes/tags), so existing memberships need no backfill — the service coalesces.
// Both FKs cascade: if Better Auth removes the membership (or the org is deleted)
// the sidecar goes with it. NOTE: our own archive lifecycle is `status='archived'`
// (the row + all history are retained), NOT auth.api.removeMember — the two are
// deliberately different operations.
export const memberProfile = pgTable(
  'member_profile',
  {
    memberId: text('member_id')
      .primaryKey()
      .references(() => member.id, { onDelete: 'cascade' }),
    // Denormalized org id so every directory query / scoped write filters by org
    // on this table directly (multi-tenant isolation, like every app-owned table),
    // without joining back through `member`.
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    // Membership lifecycle (active | suspended | archived) — see MEMBER_STATUSES.
    status: text('status').default('active').notNull(),
    // Capability seam: this person may be assigned as a coach on lessons even when
    // their governance role isn't `coach` (an owner/admin who also teaches).
    // Orthogonal to the role, mirroring the org `types[]` capability model.
    canCoach: boolean('can_coach').default(false).notNull(),
    // A CALENDAR date, never an instant — `date` (not timestamp) on purpose: a
    // birthday must not shift across timezones. Drives the derived minor check
    // (shared/member-guardian.ts); never store an `isMinor` flag, it would drift
    // as birthdays pass.
    dateOfBirth: date('date_of_birth'),
    // Staff-only internal note (CRM) — never shown to the member themselves.
    notes: text('notes'),
    // Free-form labels (e.g. 'beginner', 'competitive'). Postgres text[].
    tags: text('tags').array(),
    // Stripe Customer id on the school's connected account when THIS member pays for
    // their own spot (an adult student). A minor's payer is their guardian, whose
    // customer id lives on memberGuardian. Set lazily at first checkout, reused.
    stripeCustomerId: text('stripe_customer_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  table => [
    // Primary access path: a facility's member directory, filtered by status.
    index('member_profile_org_status_idx').on(table.organizationId, table.status)
  ]
)

export const memberProfileRelations = relations(memberProfile, ({ one }) => ({
  member: one(member, {
    fields: [memberProfile.memberId],
    references: [member.id]
  }),
  organization: one(organization, {
    fields: [memberProfile.organizationId],
    references: [organization.id]
  })
}))

// Who the school calls about a member — the emergency/legal contact behind a
// minor. App-owned and product-neutral **CORE**: this describes a *person*, not a
// lesson, so a future Courtto facility with junior members reuses it unchanged.
//
// A guardian is a CONTACT RECORD, not an account: a parent must be reachable from
// day one, long before (and often without ever) signing up. Linking a guardian to
// a `user` for a future parent portal is a later, additive column — not a seam
// carried here unused.
//
// A member may have several (both parents, a grandparent, a carer). Exactly one is
// `isPrimary` — who gets called FIRST — enforced in the DB by the partial unique
// index below, not merely by service discipline.
export const memberGuardian = pgTable(
  'member_guardian',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    // The person being looked after. Cascade: a guardian record has no meaning
    // once the membership it describes is gone.
    memberId: text('member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // One of GUARDIAN_RELATIONSHIPS (validated by the shared schema).
    relationship: text('relationship').notNull(),
    phone: text('phone'),
    email: text('email'),
    isPrimary: boolean('is_primary').default(false).notNull(),
    // Staff-only (e.g. "collects on Tuesdays", "do not contact before 5pm").
    notes: text('notes'),
    // Stripe Customer id on the school's connected account when THIS guardian pays
    // for a child's spot. One customer per guardian, reused across their children —
    // set lazily at first checkout.
    stripeCustomerId: text('stripe_customer_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  table => [
    // Primary access path: one member's guardians.
    index('member_guardian_member_idx').on(table.memberId),
    // At most ONE primary contact per member — the DB is the source of truth for
    // this invariant; the service keeps it true by demoting the incumbent in the
    // same transaction, and this index is the backstop that makes a concurrent
    // write impossible rather than merely unlikely.
    uniqueIndex('member_guardian_primary_uidx')
      .on(table.memberId)
      .where(sql`${table.isPrimary}`)
  ]
)

export const memberGuardianRelations = relations(memberGuardian, ({ one }) => ({
  organization: one(organization, {
    fields: [memberGuardian.organizationId],
    references: [organization.id]
  }),
  member: one(member, {
    fields: [memberGuardian.memberId],
    references: [member.id]
  })
}))

// A member's consent decisions (RODO/GDPR). App-owned, product-neutral CORE — it
// records a person's decision, not a lesson.
//
// This row is the CURRENT state ("may we, right now?"); the append-only history
// ("prove they consented, and when") is the audit trail, which records every grant
// and withdrawal. Together they satisfy art. 7(1) accountability without making the
// operational question expensive.
//
// Withdrawal never deletes the row and never clears `grantedAt`: erasing it would
// destroy the evidence of the period during which processing WAS lawful. Absence of
// a row means "never asked", which is deliberately distinct from "withdrawn" (see
// CONSENT_STATES).
export const memberConsent = pgTable(
  'member_consent',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    memberId: text('member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    // One of CONSENT_TYPES — only purposes that are genuinely consent-based.
    type: text('type').notNull(),
    // One of CONSENT_DECISIONS.
    status: text('status').notNull(),
    grantedAt: timestamp('granted_at'),
    withdrawnAt: timestamp('withdrawn_at'),
    // WHO gave it, snapshotted as text: accountability must outlive the guardian
    // record it came from (a guardian can be removed; the evidence cannot).
    grantedByName: text('granted_by_name'),
    // The guardian who gave it, while they still exist. `set null` — the snapshot
    // above is what survives; this is only the live link.
    guardianId: text('guardian_id').references(() => memberGuardian.id, { onDelete: 'set null' }),
    // Which version of the clause was in force. Consent is consent *to a stated
    // purpose*: if the wording changes, the old consent no longer covers the new
    // one — so "consented" is meaningless without recording "to what".
    documentVersion: text('document_version'),
    notes: text('notes'),
    // The staff member who entered it (a school collects a paper form, an admin
    // records it). Denormalized — the trail outlives their membership.
    recordedByMemberId: text('recorded_by_member_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  table => [
    // One current decision per (member, purpose).
    uniqueIndex('member_consent_member_type_uidx').on(table.memberId, table.type),
    // "Which students may we photograph?" — the roster-level compliance question.
    index('member_consent_org_type_idx').on(table.organizationId, table.type)
  ]
)

export const memberConsentRelations = relations(memberConsent, ({ one }) => ({
  organization: one(organization, {
    fields: [memberConsent.organizationId],
    references: [organization.id]
  }),
  member: one(member, {
    fields: [memberConsent.memberId],
    references: [member.id]
  }),
  guardian: one(memberGuardian, {
    fields: [memberConsent.guardianId],
    references: [memberGuardian.id]
  })
}))

// App-owned, product-neutral governance audit trail: an append-only record of who
// did what to whom, per org. CORE (the future Courtto admin panel reuses it). The
// actor/target are DENORMALIZED ids (no FK) on purpose — an audit trail must
// outlive the people it references, so removing a member never erases or orphans
// their history; display identity (names) is snapshotted into `data`. `action` is
// a stable machine key (AUDIT_ACTIONS) — never localized text (rule 5); the client
// renders `audit.actions.<action>` with `data` interpolated. Append-only: rows are
// never updated (no updatedAt), only inserted and read.
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    actorMemberId: text('actor_member_id'),
    targetMemberId: text('target_member_id'),
    action: text('action').notNull(),
    data: jsonb('data').$type<Record<string, string | number | null>>(),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => [
    // The org-wide feed, newest first.
    index('audit_log_org_created_idx').on(table.organizationId, table.createdAt.desc()),
    // One member's activity timeline (the cockpit reads this).
    index('audit_log_target_created_idx').on(table.targetMemberId, table.createdAt.desc())
  ]
)

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  organization: one(organization, {
    fields: [auditLog.organizationId],
    references: [organization.id]
  })
}))

// A named grouping of courts within a facility ("Hall A", "Outdoor"). App-owned,
// facility-core and first-class (not a free-text column): the roster sections by
// it and a future marketplace can surface areas. A court references at most one
// zone; deleting a zone UNGROUPS its courts (FK set null on court.zoneId) rather
// than removing them.
export const courtZone = pgTable(
  'court_zone',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // Display order within the facility (drag-reorder); assigned max+1 on create.
    sortOrder: integer('sort_order').default(0).notNull(),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  table => [
    index('court_zone_org_sort_idx').on(table.organizationId, table.sortOrder),
    // No two zones share a (case-insensitive) name within a facility.
    uniqueIndex('court_zone_org_name_uidx').on(table.organizationId, sql`lower(${table.name})`)
  ]
)

export const courtZoneRelations = relations(courtZone, ({ one, many }) => ({
  organization: one(organization, {
    fields: [courtZone.organizationId],
    references: [organization.id]
  }),
  courts: many(court)
}))

// A single court (or table) belonging to a facility. App-owned — facility-core,
// NOT Academy: the future Courtto marketplace books these exact rows, so nothing
// here references lessons/coaches/students. `archivedAt` is the lifecycle axis
// (soft-delete) — a court is soft-archived rather than hard-deleted so historical
// schedule/booking references stay valid. Time-bounded unavailability (maintenance
// / closures) is NOT a court flag: it's a standalone `reservation` block (see
// COURT_BLOCK_KINDS), which the court-overlap EXCLUDE then enforces against
// lessons. The white-line PATTERN is derived from `sport` (shared/courts.ts),
// never stored; only the surface/line colours are per-court.
export const court = pgTable(
  'court',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    // One of the org's declared sports (shared SPORTS); validated ⊂ orgProfile.sports
    // on write. Drives terminology (court vs table) and the rendered geometry.
    sport: text('sport').notNull(),
    // Surface key valid for `sport` (shared SURFACES_BY_SPORT); null when the
    // discipline has no surface concept (table tennis) or it's unspecified.
    surface: text('surface'),
    environment: text('environment').default('indoor').notNull(),
    // Visual customisation for the diagram — surface fill + line colour (#rrggbb).
    surfaceColor: text('surface_color').notNull(),
    lineColor: text('line_color').default('#ffffff').notNull(),
    // Display order within the facility (drag-reorder); assigned max+1 on create.
    sortOrder: integer('sort_order').default(0).notNull(),
    // The zone (area/hall) this court belongs to, or null when ungrouped. FK set
    // null on zone delete, so removing a zone ungroups its courts (see courtZone).
    zoneId: text('zone_id').references(() => courtZone.id, { onDelete: 'set null' }),
    // Seam for the future Courtto marketplace — whether this court may be exposed
    // publicly for booking. Unused by Academy today.
    bookable: boolean('bookable').default(false).notNull(),
    notes: text('notes'),
    // Soft-delete: null = active roster, set = archived (retained for history).
    archivedAt: timestamp('archived_at'),
    // Audit; nulled rather than cascade-deleted if the creator leaves the school.
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  table => [
    // Primary access path: a facility's roster in display order.
    index('court_org_sort_idx').on(table.organizationId, table.sortOrder),
    // No two active courts share a (case-insensitive) name within a facility;
    // archived rows are exempt so a name frees up once a court is retired.
    uniqueIndex('court_org_name_uidx')
      .on(table.organizationId, sql`lower(${table.name})`)
      .where(sql`${table.archivedAt} is null`)
  ]
)

export const courtRelations = relations(court, ({ one }) => ({
  organization: one(organization, {
    fields: [court.organizationId],
    references: [organization.id]
  }),
  zone: one(courtZone, {
    fields: [court.zoneId],
    references: [courtZone.id]
  })
}))

// Per-user notification inbox. Each row is one recipient's own copy, with its
// own read/dismissed state — notifications are never shared across users. The
// row carries a stable machine `type` + JSON `data` (interpolation params),
// never localized text (rule 5); the client renders the copy.
//
// `organizationId` tags the notification with the school it belongs to (null =
// account-level). The bell scopes to the active org + account-level items, so a
// user who owns one school and coaches at another never sees the two contexts
// mixed. Both FKs cascade: deleting a user or an org clears their notifications.
export const notification = pgTable(
  'notification',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    // Interpolation params for the localized title/body and any render metadata.
    data: jsonb('data').$type<Record<string, string | number | null>>(),
    // Deep link the bell navigates to on click (null = not clickable).
    link: text('link'),
    // null = unread; set when the user opens the bell (marks the scope read).
    readAt: timestamp('read_at'),
    // System-managed notifications set this false: no `x`, skipped by "clear
    // all", resolved programmatically when their condition clears.
    dismissible: boolean('dismissible').default(true).notNull(),
    // Set on singleton/system notifications so they're created at most once per
    // (user, key) — see the partial unique index below. null for transient ones.
    dedupeKey: text('dedupe_key'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => [
    // Primary access path: a user's inbox, newest first.
    index('notification_user_created_idx').on(table.userId, table.createdAt.desc()),
    // Idempotency for system/singleton notifications, without constraining the
    // transient ones (which leave dedupeKey null).
    uniqueIndex('notification_user_dedupe_uidx')
      .on(table.userId, table.dedupeKey)
      .where(sql`${table.dedupeKey} is not null`)
  ]
)

export const notificationRelations = relations(notification, ({ one }) => ({
  user: one(user, {
    fields: [notification.userId],
    references: [user.id]
  }),
  organization: one(organization, {
    fields: [notification.organizationId],
    references: [organization.id]
  })
}))

// ─── SCHEDULE ────────────────────────────────────────────────────────────────
//
// Two layers, kept physically separate (see CLAUDE.md). `reservation` is the
// facility-CORE occupancy primitive (court × time) the future Courtto
// marketplace will book identically — it references nothing Academy. The lesson
// tables are the ACADEMY layer on top; they point DOWN at a reservation, never
// the reverse. All app-owned → written with Drizzle directly (rule 4 is scoped
// to Better-Auth tables), and every query is scoped by organizationId.
//
// Domain time columns (starts_at/ends_at/occurrence_start/materialized_until)
// are `timestamp with time zone` — absolute UTC instants — unlike the plain
// `timestamp` audit columns elsewhere. This is deliberate: scheduling must be
// unambiguous across DST, and the court double-booking EXCLUDE constraint below
// operates on these instants.

// CORE — the occupancy primitive: one court occupied for one time range.
export const reservation = pgTable(
  'reservation',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    courtId: text('court_id')
      .notNull()
      .references(() => court.id, { onDelete: 'cascade' }),
    // Absolute UTC instants — the half-open range [startsAt, endsAt).
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    // Operational state; only non-cancelled rows count toward the overlap
    // constraint (partial EXCLUDE, hand-added in the migration — Drizzle can't
    // express EXCLUDE, so it lives there, not here).
    status: text('status').default('confirmed').notNull(),
    // Neutral reason for the occupancy (blocked | maintenance | booking | lesson).
    // Defaults to the product-neutral `blocked`, NOT `lesson` — the Academy layer
    // sets kind='lesson' explicitly, keeping this core primitive unbiased.
    kind: text('kind').default('blocked').notNull(),
    // Free text for standalone blocks (maintenance / open-court) that have no
    // Academy row to carry their label.
    title: text('title'),
    note: text('note'),
    // Seam for the future Courtto marketplace: who booked this (customer/public).
    // Unused by Academy today.
    bookedByType: text('booked_by_type'),
    bookedById: text('booked_by_id'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  table => [
    index('reservation_org_starts_idx').on(table.organizationId, table.startsAt),
    index('reservation_court_starts_idx').on(table.courtId, table.startsAt),
    // A reservation must span a real (non-empty) interval. Without this, a
    // zero-duration row makes tstzrange(startsAt, endsAt) EMPTY, and `empty && x`
    // is false — so the overlap EXCLUDE would silently stop guarding that court.
    // The service already enforces durationMin ≥ 5, but this backstops every
    // writer of the core primitive (future marketplace/maintenance blocks).
    check('reservation_time_order_chk', sql`${table.endsAt} > ${table.startsAt}`)
  ]
)

export const reservationRelations = relations(reservation, ({ one }) => ({
  organization: one(organization, {
    fields: [reservation.organizationId],
    references: [organization.id]
  }),
  court: one(court, {
    fields: [reservation.courtId],
    references: [court.id]
  })
}))

// ACADEMY — the recurring lesson definition + template. `rrule` (RFC 5545) null
// means a one-off; `dtStart` is wall-clock local ('YYYY-MM-DDTHH:mm') and
// `timezone` an IANA zone snapshotted from orgProfile at creation, so a later
// change to the school's zone never silently shifts an existing series.
export const lessonSeries = pgTable(
  'lesson_series',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    // Nature of the lesson (group | individual | open). Orthogonal to recurrence.
    type: text('type').notNull(),
    // One of the org's declared sports (⊂ orgProfile.sports; validated in the service).
    sport: text('sport').notNull(),
    title: text('title').notNull(),
    // Hex colour for the calendar block (reuses the court palette).
    color: text('color').notNull(),
    level: text('level'),
    ageGroup: text('age_group'),
    notes: text('notes'),
    // Assistant coach — a seam (unused in v1 UI). The WHEN/WHERE/WHO-teaches of a
    // group lives on its rules (lessonSeriesRule), not here.
    assistantCoachMemberId: text('assistant_coach_member_id').references(() => member.id, { onDelete: 'set null' }),
    // IANA zone the group's wall-clock times resolve in (snapshotted at create).
    timezone: text('timezone').notNull(),
    capacityMin: integer('capacity_min'),
    capacityMax: integer('capacity_max'),
    enrollmentOpen: boolean('enrollment_open').default(true).notNull(),
    // Seam: minutes-before-start after which enrolment closes (unused in v1 UI).
    enrollmentDeadlineMin: integer('enrollment_deadline_min'),
    visibility: text('visibility').default('members').notNull(),
    status: text('status').default('active').notNull(),
    // The monthly pricing plan a parent is billed for this group's spot (ACADEMY
    // payments). Null = a free/unbilled group. `set null` on delete so removing a
    // plan ungroups its groups rather than deleting them (plans are archived, not
    // deleted, so this is a backstop).
    pricingPlanId: text('pricing_plan_id').references(() => pricingPlan.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  table => [
    index('lesson_series_org_idx').on(table.organizationId)
  ]
)

export const lessonSeriesRelations = relations(lessonSeries, ({ one, many }) => ({
  organization: one(organization, {
    fields: [lessonSeries.organizationId],
    references: [organization.id]
  }),
  rules: many(lessonSeriesRule)
}))

// ACADEMY — a single recurrence PATTERN of a series (the enrolment group). A
// series has 1..N rules, so one group can meet at several different day/time
// slots (e.g. Wed 15:00 on court 1 + Thu 13:00 on court 2) — something a single
// RRULE can't express (RFC 5545 anchors every occurrence to DTSTART's time; the
// standard's answer to "different times per day" is separate VEVENTs, i.e. these
// rules). Each rule maps 1:1 to a VEVENT. WHEN + WHERE + WHO-teaches live here;
// the series holds WHO-is-enrolled + WHAT (title/type/sport/capacity). Materialized
// sessions point UP at their rule via `ruleId`, so divergence, propagation and the
// rolling horizon (`materializedUntil`) are per-rule.
export const lessonSeriesRule = pgTable(
  'lesson_series_rule',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    seriesId: text('series_id')
      .notNull()
      .references(() => lessonSeries.id, { onDelete: 'cascade' }),
    // RFC 5545 recurrence; null = a single occurrence for this rule.
    rrule: text('rrule'),
    // Wall-clock local start of this pattern, 'YYYY-MM-DDTHH:mm'.
    dtStart: text('dt_start').notNull(),
    durationMin: integer('duration_min').notNull(),
    timezone: text('timezone').notNull(),
    // Per-pattern resources — different rules of one group can run on different
    // courts / with different coaches. Nulled (not cascaded away) if the court is
    // removed or the coach leaves, mirroring the series columns they replace.
    courtId: text('court_id').references(() => court.id, { onDelete: 'set null' }),
    coachMemberId: text('coach_member_id').references(() => member.id, { onDelete: 'set null' }),
    // How far this rule has been materialized (rolling horizon, extended lazily).
    materializedUntil: timestamp('materialized_until', { withTimezone: true }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  table => [
    index('lesson_series_rule_org_idx').on(table.organizationId),
    index('lesson_series_rule_series_idx').on(table.seriesId),
    // Drives the materialization sweep once it scans rules (Phase 2). Partial to
    // recurring rules, mirroring lesson_series_materialization_idx.
    index('lesson_series_rule_materialization_idx')
      .on(table.materializedUntil)
      .where(sql`${table.rrule} is not null`)
  ]
)

export const lessonSeriesRuleRelations = relations(lessonSeriesRule, ({ one }) => ({
  organization: one(organization, {
    fields: [lessonSeriesRule.organizationId],
    references: [organization.id]
  }),
  series: one(lessonSeries, {
    fields: [lessonSeriesRule.seriesId],
    references: [lessonSeries.id]
  }),
  court: one(court, {
    fields: [lessonSeriesRule.courtId],
    references: [court.id]
  }),
  coach: one(member, {
    fields: [lessonSeriesRule.coachMemberId],
    references: [member.id]
  })
}))

// ACADEMY — a materialized occurrence (1 row = 1 instance). Points DOWN at the
// core reservation it consumes. `occurrenceStart` is the original recurrence
// anchor (stable key matched by an exception); `startsAt`/`endsAt`/`courtId`/
// `coachMemberId` hold the RESOLVED values (denormalized from the series at
// materialization and kept in sync by the service — the single writer) so a
// coach's schedule, the roster and the future coach-overlap constraint need no
// join back to the series. `overridden` marks an occurrence manually diverged
// from the template, which "edit the whole series" then skips.
//
// LIFECYCLE CONTRACT: the FK below cascades reservation→session (deleting a
// reservation deletes its session), but NOT the reverse — core deliberately has
// no FK up to Academy. So the service MUST delete a session's (and a series')
// reservation(s) transactionally when hard-deleting; skipping it would leave
// phantom court occupancy the EXCLUDE keeps enforcing with no visible lesson.
// Normal cancellation avoids this: it flips status to 'cancelled' on both rows
// (freeing the court via the partial EXCLUDE) rather than deleting.
export const lessonSession = pgTable(
  'lesson_session',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    // Every session belongs to a series (a one-off is a series with rrule null);
    // bare court occupancy with no lesson is a plain `reservation`, not a session.
    seriesId: text('series_id')
      .notNull()
      .references(() => lessonSeries.id, { onDelete: 'cascade' }),
    // The recurrence rule that produced this occurrence. Nullable during the
    // expand phase (backfilled for existing rows); becomes the divergence/
    // propagation anchor once services read rules (Phase 2), NOT NULL in Phase 4.
    ruleId: text('rule_id').references(() => lessonSeriesRule.id, { onDelete: 'cascade' }),
    reservationId: text('reservation_id')
      .notNull()
      .references(() => reservation.id, { onDelete: 'cascade' }),
    occurrenceStart: timestamp('occurrence_start', { withTimezone: true }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    // Resolved coach for this occurrence (the substitute when overridden); null
    // means no coach, e.g. an open-court block. Not "inherit" — the value is
    // materialized so coach queries stay single-table.
    coachMemberId: text('coach_member_id').references(() => member.id, { onDelete: 'set null' }),
    // Resolved court for this occurrence — mirrors the linked reservation.
    courtId: text('court_id').references(() => court.id, { onDelete: 'set null' }),
    capacityMax: integer('capacity_max'),
    status: text('status').default('scheduled').notNull(),
    cancelReason: text('cancel_reason'),
    // True once this occurrence has been manually diverged from the series
    // template, so "edit the whole series" skips it.
    overridden: boolean('overridden').default(false).notNull(),
    notes: text('notes'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  table => [
    index('lesson_session_org_starts_idx').on(table.organizationId, table.startsAt),
    index('lesson_session_series_idx').on(table.seriesId),
    index('lesson_session_rule_idx').on(table.ruleId),
    index('lesson_session_coach_starts_idx').on(table.coachMemberId, table.startsAt),
    // A RULE produces at most one session per original occurrence — the guard that
    // re-materialization never duplicates an occurrence. Keyed by rule (not series)
    // so two slots of one group MAY share an instant on different courts (e.g. the
    // group splits across two courts at the same hour). NULL rule_id (a detached
    // historical session) is unconstrained, which is correct — those aren't
    // materialized against.
    uniqueIndex('lesson_session_rule_occurrence_uidx').on(table.ruleId, table.occurrenceStart),
    // A session must span a real (non-empty) interval — the same guard reservation
    // carries. Without it a zero-length range makes tstzrange(startsAt, endsAt)
    // EMPTY, and `empty && x` is false, silently defeating the coach-overlap
    // EXCLUDE (hand-added in the migration — Drizzle can't express EXCLUDE) that
    // relies on it. The service enforces durationMin ≥ 5, but this backstops it.
    check('lesson_session_time_order_chk', sql`${table.endsAt} > ${table.startsAt}`)
  ]
)

export const lessonSessionRelations = relations(lessonSession, ({ one }) => ({
  organization: one(organization, {
    fields: [lessonSession.organizationId],
    references: [organization.id]
  }),
  series: one(lessonSeries, {
    fields: [lessonSession.seriesId],
    references: [lessonSeries.id]
  }),
  rule: one(lessonSeriesRule, {
    fields: [lessonSession.ruleId],
    references: [lessonSeriesRule.id]
  }),
  reservation: one(reservation, {
    fields: [lessonSession.reservationId],
    references: [reservation.id]
  }),
  coach: one(member, {
    fields: [lessonSession.coachMemberId],
    references: [member.id]
  }),
  court: one(court, {
    fields: [lessonSession.courtId],
    references: [court.id]
  })
}))

// ACADEMY — the durable ledger of occurrences that diverge from the pure RRULE
// expansion (iCalendar EXDATE / RECURRENCE-ID). `action` = cancelled (EXDATE),
// rescheduled (moved) or modified (other override); `sessionId` links the
// overriding session row when one exists. Lets re-materialization and
// "edit the whole series" leave manual changes untouched.
export const lessonException = pgTable(
  'lesson_exception',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    seriesId: text('series_id')
      .notNull()
      .references(() => lessonSeries.id, { onDelete: 'cascade' }),
    // The rule this divergence belongs to (Phase 2 keys exceptions per rule).
    // Nullable during expand; backfilled for existing rows.
    ruleId: text('rule_id').references(() => lessonSeriesRule.id, { onDelete: 'cascade' }),
    occurrenceStart: timestamp('occurrence_start', { withTimezone: true }).notNull(),
    action: text('action').notNull(),
    sessionId: text('session_id').references(() => lessonSession.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => [
    // At most one exception per (rule, original occurrence) — keyed by rule, so
    // each slot of a group keeps its own divergence ledger even when two slots
    // share an instant (mirrors lesson_session_rule_occurrence_uidx). The unique
    // index also serves ruleId-prefix lookups, so no separate rule index is needed.
    uniqueIndex('lesson_exception_rule_occurrence_uidx').on(table.ruleId, table.occurrenceStart)
  ]
)

export const lessonExceptionRelations = relations(lessonException, ({ one }) => ({
  organization: one(organization, {
    fields: [lessonException.organizationId],
    references: [organization.id]
  }),
  series: one(lessonSeries, {
    fields: [lessonException.seriesId],
    references: [lessonSeries.id]
  }),
  rule: one(lessonSeriesRule, {
    fields: [lessonException.ruleId],
    references: [lessonSeriesRule.id]
  }),
  session: one(lessonSession, {
    fields: [lessonException.sessionId],
    references: [lessonSession.id]
  })
}))

// ACADEMY — a student's enrolment, either in a whole series (recurring) OR a
// single session (drop-in / make-up). Exactly one of seriesId/sessionId is set
// (CHECK below). Capacity/waitlist are computed per session from these rows.
export const enrollment = pgTable(
  'enrollment',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    studentMemberId: text('student_member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    seriesId: text('series_id').references(() => lessonSeries.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => lessonSession.id, { onDelete: 'cascade' }),
    status: text('status').default('enrolled').notNull(),
    // Position on the waitlist when status = waitlisted; null otherwise.
    waitlistPos: integer('waitlist_pos'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  table => [
    index('enrollment_series_idx').on(table.seriesId),
    index('enrollment_session_idx').on(table.sessionId),
    index('enrollment_student_idx').on(table.studentMemberId),
    // Exactly one enrolment target (series XOR session).
    check(
      'enrollment_target_chk',
      sql`(("series_id" is not null)::int + ("session_id" is not null)::int) = 1`
    ),
    // One enrolment row per (target, student) — re-enrolling reuses the row.
    uniqueIndex('enrollment_series_student_uidx')
      .on(table.seriesId, table.studentMemberId)
      .where(sql`${table.seriesId} is not null`),
    uniqueIndex('enrollment_session_student_uidx')
      .on(table.sessionId, table.studentMemberId)
      .where(sql`${table.sessionId} is not null`)
  ]
)

export const enrollmentRelations = relations(enrollment, ({ one }) => ({
  organization: one(organization, {
    fields: [enrollment.organizationId],
    references: [organization.id]
  }),
  student: one(member, {
    fields: [enrollment.studentMemberId],
    references: [member.id]
  }),
  series: one(lessonSeries, {
    fields: [enrollment.seriesId],
    references: [lessonSeries.id]
  }),
  session: one(lessonSession, {
    fields: [enrollment.sessionId],
    references: [lessonSession.id]
  })
}))

// ACADEMY — the billing state of one enrolment's paid spot, MIRRORED from a Stripe
// subscription on the school's connected account (webhooks are the source of truth;
// see shared/enrollment-billing.ts for the status vocabulary). Sidecar to
// `enrollment` (PK = enrollmentId, 1:1) so the enrolment row stays payment-neutral.
// `status` default is `pending_payment` — a row exists once a checkout link is sent.
// Money amounts are never stored here; Stripe holds the ledger.
export const enrollmentBilling = pgTable(
  'enrollment_billing',
  {
    enrollmentId: text('enrollment_id')
      .primaryKey()
      .references(() => enrollment.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    status: text('status').default('pending_payment').notNull(),
    // Stripe object ids on the CONNECTED account. The customer is the payer
    // (guardian or adult student); the subscription is the recurring monthly charge.
    stripeCustomerId: text('stripe_customer_id'),
    stripeSubscriptionId: text('stripe_subscription_id'),
    checkoutSessionId: text('checkout_session_id'),
    // Mirrored from the subscription — when the current paid period ends.
    currentPeriodEnd: timestamp('current_period_end', { withTimezone: true }),
    // Mirrored: the subscription is set to stop at the period end (staff cancelled,
    // or the parent cancelled in the portal). Status stays `active` until then, so
    // this is how the roster shows "ends on {currentPeriodEnd}".
    cancelAtPeriodEnd: boolean('cancel_at_period_end').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at')
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull()
  },
  table => [
    index('enrollment_billing_org_idx').on(table.organizationId),
    index('enrollment_billing_subscription_idx').on(table.stripeSubscriptionId)
  ]
)

export const enrollmentBillingRelations = relations(enrollmentBilling, ({ one }) => ({
  enrollment: one(enrollment, {
    fields: [enrollmentBilling.enrollmentId],
    references: [enrollment.id]
  })
}))

// Append-only internal audit of staff MONEY MOVEMENTS (a link sent, a subscription
// cancelled, a refund issued) — the accountability trail on top of Stripe (which
// stays the authoritative money ledger). Never updated or deleted by the app. The
// actor and subject are DENORMALIZED (no FK) + name-snapshotted, so an entry
// outlives the staff member or enrolment it refers to (same principle as auditLog).
// Money is INTEGER minor units (grosze); `stripeRef` is the Stripe object id
// (refund/subscription/session) for reconciliation against Stripe.
export const paymentAudit = pgTable(
  'payment_audit',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    actorMemberId: text('actor_member_id'),
    actorName: text('actor_name'),
    action: text('action').notNull(),
    enrollmentId: text('enrollment_id'),
    studentName: text('student_name'),
    amountMinor: integer('amount_minor'),
    currency: text('currency'),
    stripeRef: text('stripe_ref'),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => [index('payment_audit_org_created_idx').on(table.organizationId, table.createdAt)]
)

// ACADEMY — actual attendance per session (present | absent | excused | late),
// recorded against the expected roster (active enrolments on that date). One
// row per (session, student).
export const attendance = pgTable(
  'attendance',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    sessionId: text('session_id')
      .notNull()
      .references(() => lessonSession.id, { onDelete: 'cascade' }),
    studentMemberId: text('student_member_id')
      .notNull()
      .references(() => member.id, { onDelete: 'cascade' }),
    status: text('status').notNull(),
    markedBy: text('marked_by').references(() => member.id, { onDelete: 'set null' }),
    markedAt: timestamp('marked_at', { withTimezone: true })
      .defaultNow()
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull()
  },
  table => [
    index('attendance_session_idx').on(table.sessionId),
    index('attendance_student_idx').on(table.studentMemberId),
    uniqueIndex('attendance_session_student_uidx').on(table.sessionId, table.studentMemberId)
  ]
)

export const attendanceRelations = relations(attendance, ({ one }) => ({
  organization: one(organization, {
    fields: [attendance.organizationId],
    references: [organization.id]
  }),
  session: one(lessonSession, {
    fields: [attendance.sessionId],
    references: [lessonSession.id]
  }),
  student: one(member, {
    fields: [attendance.studentMemberId],
    references: [member.id]
  })
}))
