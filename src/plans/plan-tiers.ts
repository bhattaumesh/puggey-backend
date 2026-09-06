// Phase 7 (Commercial): plan tiers and their limits. These are business
// pricing decisions, not statutory figures -- unlike Phase 8's payroll rates,
// there is nothing here that needs REQUIRES_VERIFICATION. Adjust freely.
// Real payment collection is out of scope until a payment provider account
// exists; this only gates a limit and lets Pugey staff move a tenant between
// tiers.
export const PLAN_TIERS = {
  trial: { label: 'Trial', maxEmployees: 5 },
  basic: { label: 'Basic', maxEmployees: 10 },
  silver: { label: 'Silver', maxEmployees: 20 },
  gold: { label: 'Gold', maxEmployees: 40 },
  platinum: { label: 'Platinum', maxEmployees: null as number | null },
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
