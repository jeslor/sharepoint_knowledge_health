// import { BadRequestException, Controller, Get, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
// import type { User } from '@sph/database';
// import type { NotificationListQuery, NotificationResponse, PaginatedResponse, SortDirection, UnreadNotificationCountResponse } from '@sph/types';
// import { EntraJwtGuard } from '../auth/entra-jwt.guard';
// import { TenantContextGuard } from '../auth/tenant-context.guard';
// import { CurrentUser } from '../auth/current-user.decorator';
// import { OrganizationAccessGuard } from '../common/organization-access.guard';
// import { NotificationsService } from './notifications.service';

// const SORT_DIR_VALUES: SortDirection[] = ['asc', 'desc'];

// /**
//  * No RolesGuard — deliberately. Every route here is already resource-scoped
//  * to the requesting user (NotificationsService never exposes another
//  * user's notifications), so there is no privileged action to further
//  * restrict by role, matching how "view issues"/audit-log reads carry no
//  * role restriction either (only mutations affecting *other* users' data
//  * do, elsewhere in this API).
//  */
// @Controller('organizations/:id/notifications')
// @UseGuards(EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard)
// export class NotificationsController {
//   constructor(private readonly notificationsService: NotificationsService) {}

//   @Get()
//   async list(
//     @Param('id') organizationId: string,
//     @CurrentUser() user: User,
//     @Query() query: Record<string, string>,
//   ): Promise<PaginatedResponse<NotificationResponse>> {
//     return this.notificationsService.list(organizationId, user.id, this.parseListQuery(query));
//   }

//   @Get('unread-count')
//   async unreadCount(@Param('id') organizationId: string, @CurrentUser() user: User): Promise<UnreadNotificationCountResponse> {
//     const count = await this.notificationsService.unreadCount(organizationId, user.id);
//     return { count };
//   }

//   @Patch(':notificationId')
//   async markRead(
//     @Param('id') organizationId: string,
//     @Param('notificationId') notificationId: string,
//     @CurrentUser() user: User,
//   ): Promise<NotificationResponse> {
//     const updated = await this.notificationsService.markRead(organizationId, user.id, notificationId);
//     if (!updated) throw new NotFoundException('Notification not found');
//     return updated;
//   }

//   @Post('mark-all-read')
//   async markAllRead(@Param('id') organizationId: string, @CurrentUser() user: User): Promise<{ updatedCount: number }> {
//     const updatedCount = await this.notificationsService.markAllRead(organizationId, user.id);
//     return { updatedCount };
//   }

//   private parseListQuery(query: Record<string, string>): NotificationListQuery {
//     const page = query.page ? Number(query.page) : undefined;
//     const pageSize = query.pageSize ? Number(query.pageSize) : undefined;

//     if (page !== undefined && (!Number.isInteger(page) || page < 1)) {
//       throw new BadRequestException('page must be a positive integer');
//     }
//     if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)) {
//       throw new BadRequestException('pageSize must be an integer between 1 and 100');
//     }
//     if (query.sortDir !== undefined && !SORT_DIR_VALUES.includes(query.sortDir as SortDirection)) {
//       throw new BadRequestException(`sortDir must be one of: ${SORT_DIR_VALUES.join(', ')}`);
//     }
//     if (query.read !== undefined && query.read !== 'true' && query.read !== 'false') {
//       throw new BadRequestException('read must be "true" or "false"');
//     }

//     return {
//       page,
//       pageSize,
//       read: query.read !== undefined ? query.read === 'true' : undefined,
//       sortDir: query.sortDir as SortDirection | undefined,
//     };
//   }
// }
