import { IsUUID } from 'class-validator';

// A supervisor (delegatorMembershipId) names a stand-in (delegateMembershipId)
// who can approve leave on their behalf specifically on days the supervisor is
// themselves on approved leave -- see LeaveService.resolveApprover.
export class CreateDelegationDto {
  @IsUUID()
  delegatorMembershipId!: string;

  @IsUUID()
  delegateMembershipId!: string;
}
