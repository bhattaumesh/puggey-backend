import { IsIn, IsOptional, IsString } from 'class-validator';

export class DecideLeaveRequestDto {
  @IsIn(['approved', 'rejected'])
  decision!: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  reason?: string;
}
