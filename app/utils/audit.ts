import { isAuditAction } from '~~/shared/audit'

// Client-side rendering of an audit entry, shared by the member cockpit's Activity
// card and the org-wide Activity log page — one place decides how a trail line
// reads. The server stores only stable action keys + a `data` snapshot (rule 5);
// the localized copy lives in `audit.actions.*`.

const ACTION_ICON: Record<string, string> = {
  'member.role_changed': 'i-lucide-user-cog',
  'member.suspended': 'i-lucide-pause',
  'member.archived': 'i-lucide-archive',
  'member.reactivated': 'i-lucide-play',
  'member.coach_granted': 'i-lucide-clipboard-list',
  'member.coach_revoked': 'i-lucide-clipboard-list',
  'member.removed': 'i-lucide-user-minus',
  'member.ownership_transferred': 'i-lucide-crown',
  'member.account_deleted': 'i-lucide-user-x'
}

export function auditActionIcon(action: string): string {
  return ACTION_ICON[action] ?? 'i-lucide-history'
}

export interface AuditEntryLike {
  action: string
  data: Record<string, string | number | null> | null
}

// An unknown action (e.g. an entry written by a newer deploy) degrades to a
// generic line rather than rendering a raw key at the user.
export function auditActionText(
  entry: AuditEntryLike,
  t: (key: string, params?: Record<string, unknown>) => string
): string {
  if (entry.action === 'member.role_changed' && entry.data?.role) {
    return t('audit.actions.member.role_changed', { role: t(`roles.${entry.data.role}`) })
  }
  const key = isAuditAction(entry.action) ? entry.action : 'unknown'
  return t(`audit.actions.${key}`)
}
