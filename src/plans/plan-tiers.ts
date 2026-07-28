// Phase 7 (Commercial): plan tiers and their limits. These are business
// pricing decisions, not statutory figures -- unlike Phase 8's payroll rates,
// there is nothing here that needs REQUIRES_VERIFICATION. Adjust freely.
// Real payment collection is out of scope until a payment provider account
// exists; this only gates a limit and lets Pugey staff move a tenant between
// tiers.
export const PLAN_TIERS = {
  trial: { label: 'Trial', maxEmployees: 5 },
  starter: { label: 'Starter', maxEmployees: 15 },
  growth: { label: 'Growth', maxEmployees: 50 },
  enterprise: { label: 'Enterprise', maxEmployees: null as number | null },
} as const;

export type PlanKey = keyof typeof PLAN_TIERS;

export function isPlanKey(value: string): value is PlanKey {
  return value in PLAN_TIERS;
}

export function planLimit(plan: string): number | null {
  return isPlanKey(plan) ? PLAN_TIERS[plan].maxEmployees : PLAN_TIERS.trial.maxEmployees;
}

export function planLabel(plan: string): string {
  return isPlanKey(plan) ? PLAN_TIERS[plan].label : plan;
}
