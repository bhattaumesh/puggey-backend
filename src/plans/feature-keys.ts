// The only keys a Plan's `features` array may ever contain. Deliberately a
// short, explicit whitelist -- core functionality (employee records,
// attendance, leave, schedule) is never on this list at all, so no plan
// edit can ever lock a paying customer out of the basics. Only genuinely
// "more value, fair to charge more for" modules go here.
export const FEATURE_KEYS = ['payroll', 'bills', 'retail', 'reports_export'] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  payroll: 'Payroll (payslips)',
  bills: 'Bills & vendors',
  retail: 'Retail tools (racks, product received, counter handling)',
  reports_export: 'Downloadable reports',
};

export function isFeatureKey(value: string): value is FeatureKey {
  return (FEATURE_KEYS as readonly string[]).includes(value);
}
