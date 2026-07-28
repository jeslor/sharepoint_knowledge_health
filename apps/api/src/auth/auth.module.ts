import { Module } from '@nestjs/common';
import { ConsentCallbackController } from './consent-callback.controller';
import { MeController } from './me.controller';
import { EntraJwtGuard } from './entra-jwt.guard';
import { TenantContextGuard } from './tenant-context.guard';
import { RolesGuard } from './roles.guard';
import { DiscoveryModule } from '../discovery/discovery.module';
import { AuditLogModule } from '../audit-log/audit-log.module';

@Module({
  // DiscoveryModule, not SharePointSitesModule — see
  // DiscoveryProducerService's doc comment for why (avoids a cycle:
  // SharePointSitesModule already imports AuthModule). AuditLogModule is a
  // pure leaf (no imports of its own), so it carries no such risk either
  // way — safe to import directly.
  imports: [DiscoveryModule, AuditLogModule],
  controllers: [ConsentCallbackController, MeController],
  providers: [EntraJwtGuard, TenantContextGuard, RolesGuard],
  exports: [EntraJwtGuard, TenantContextGuard, RolesGuard],
})
export class AuthModule {}
