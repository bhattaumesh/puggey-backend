import { IsIn } from 'class-validator';

const TENANT_STATUSES = ['trial', 'active', 'past_due', 'suspended', 'cancelled', 'purged'] as const;

export class UpdateTenantStatusDto {
  @IsIn(TENANT_STATUSES)
  status!: (typeof TENANT_STATUSES)[number];
}
