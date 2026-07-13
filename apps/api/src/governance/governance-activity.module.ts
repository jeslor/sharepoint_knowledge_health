import { Module } from '@nestjs/common';
import { GovernanceActivityService } from './governance-activity.service';

// Shared with DocumentsModule (ownership assignment/removal activity) as
// well as GovernanceIssuesModule — a standalone module, not folded into
// either, since it's a dependency of both rather than belonging to one.
@Module({
  providers: [GovernanceActivityService],
  exports: [GovernanceActivityService],
})
export class GovernanceActivityModule {}
