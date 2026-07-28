import { IsIn } from 'class-validator';

export class UpdateTaskStatusDto {
  @IsIn(['pending', 'in_progress', 'completed'])
  status!: 'pending' | 'in_progress' | 'completed';
}
