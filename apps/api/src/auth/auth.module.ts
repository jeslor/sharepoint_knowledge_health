import { Module } from '@nestjs/common';
import { ConsentCallbackController } from './consent-callback.controller';
import { MeController } from './me.controller';
import { EntraJwtGuard } from './entra-jwt.guard';
import { TenantContextGuard } from './tenant-context.guard';
import { RolesGuard } from './roles.guard';
import { DiscoveryModule } from '../discovery/discovery.module';

@Module({
  // DiscoveryModule, not SharePointSitesModule — see
  // DiscoveryProducerService's doc comment for why (avoids a cycle:
  // SharePointSitesModule already imports AuthModule).
  imports: [DiscoveryModule],
  controllers: [ConsentCallbackController, MeController],
  providers: [EntraJwtGuard, TenantContextGuard, RolesGuard],
  exports: [EntraJwtGuard, TenantContextGuard, RolesGuard],
})
export class AuthModule {}
