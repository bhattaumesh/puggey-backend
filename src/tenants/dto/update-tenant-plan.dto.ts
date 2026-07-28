import { IsString } from 'class-validator';

export class UpdateTenantPlanDto {
  @IsString()
  plan!: string;
}
