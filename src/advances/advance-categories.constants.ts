// Seeded once per tenant at creation time (self-service signup and platform
// console provisioning both call this). Admins can rename, add, or
// soft-delete freely afterward -- this is only the starting set.
export const DEFAULT_ADVANCE_CATEGORIES = ['Advance salary', 'Purchase', 'Khaja'] as const;
