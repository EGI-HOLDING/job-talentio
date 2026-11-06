import { NotFoundException } from '@nestjs/common';

export const hrFlowEnabled = () => process.env.HR_CREATION_V2_ENABLED === 'true' && process.env.HR_FLOW_MARKET === 'id';
export function assertHrFlowEnabled() {
  if (!hrFlowEnabled()) throw new NotFoundException('HR creation flow is not enabled');
}
