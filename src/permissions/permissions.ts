import { TenantRole } from '@prisma/client';

// Single source of truth for the permission map (spec section 6). Server-side
// guards import these functions directly for authorization. The frontend never
// re-implements this logic -- it calls GET /me/permissions and uses the response
// purely to decide what to render, never to decide what's allowed.
//
// Role naming: SUPER_ADMIN (tenant-scoped, full operational control) was called
// "Company Admin" in the spec. ADMIN (tenant-scoped, read-only oversight) was
// called "CEO". This was an explicit renaming decision, not a mistake -- Super
// Admin outranks Admin here, which inverts the usual meaning of those words.

export type EffectiveRole = 'PUGEY_STAFF' | TenantRole;

export function canCheckInOut(role: EffectiveRole, tenantAllowsAdminCheckIn = false): boolean {
  if (role === 'PUGEY_STAFF' || role === 'SUPER_ADMIN') return false; // absent, not disabled
  if (role === 'ADMIN') return tenantAllowsAdminCheckIn; // "Configurable" per spec
  return role === 'SUPERVISOR' || role === 'EMPLOYEE';
}

export function myTeamScope(role: EffectiveRole): 'all' | 'subtree' | 'none' {
  if (role === 'PUGEY_STAFF') return 'none';
  if (role === 'SUPER_ADMIN' || role === 'ADMIN') return 'all';
  if (role === 'SUPERVISOR') return 'subtree';
  return 'none'; // EMPLOYEE: hidden entirely, not greyed out
}

export function canCreateEditDeleteAnyRecord(role: EffectiveRole): boolean {
  return role === 'SUPER_ADMIN';
}

export function canCorrectAttendance(role: EffectiveRole, grantedForOwnTeam = false): boolean {
  if (role === 'SUPER_ADMIN') return true;
  if (role === 'SUPERVISOR') return grantedForOwnTeam;
  return false;
}

export function canAssignRolesAndPermissions(role: EffectiveRole): boolean {
  return role === 'PUGEY_STAFF' || role === 'SUPER_ADMIN';
}

export function canApproveLeave(role: EffectiveRole, isDelegatedApprover = false): boolean {
  if (role === 'SUPER_ADMIN') return true; // always, per spec
  return isDelegatedApprover; // ADMIN, SUPERVISOR, EMPLOYEE: only if delegated
}

export function canManageTenantSettings(role: EffectiveRole): boolean {
  return role === 'SUPER_ADMIN';
}

export type ReportScope = 'platform' | 'full' | 'org_read_only' | 'own_team' | 'own_record';

export function reportScope(role: EffectiveRole): ReportScope {
  switch (role) {
    case 'PUGEY_STAFF':
      return 'platform';
    case 'SUPER_ADMIN':
      return 'full';
    case 'ADMIN':
      return 'org_read_only';
    case 'SUPERVISOR':
      return 'own_team';
    default:
      return 'own_record';
  }
}

// Full snapshot returned by GET /me/permissions -- the frontend renders from this,
// it does not recompute any of the above logic itself.
export function effectivePermissions(role: EffectiveRole, opts: { tenantAllowsAdminCheckIn?: boolean; hasAttendanceCorrectionGrant?: boolean; isDelegatedLeaveApprover?: boolean } = {}) {
  return {
    role,
    canCheckInOut: canCheckInOut(role, opts.tenantAllowsAdminCheckIn),
    myTeamScope: myTeamScope(role),
    canCreateEditDeleteAnyRecord: canCreateEditDeleteAnyRecord(role),
    canCorrectAttendance: canCorrectAttendance(role, opts.hasAttendanceCorrectionGrant),
    canAssignRolesAndPermissions: canAssignRolesAndPermissions(role),
    canApproveLeave: canApproveLeave(role, opts.isDelegatedLeaveApprover),
    canManageTenantSettings: canManageTenantSettings(role),
    reportScope: reportScope(role),
  };
}
