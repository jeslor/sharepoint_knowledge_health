import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { User } from '@sph/database';
import type {
  AssignDocumentOwnerRequest,
  DocumentDetailResponse,
  DocumentHealthQuery,
  DocumentHealthSortBy,
  DocumentOwnerResponse,
  DocumentResponse,
  DocumentReviewResponse,
  DocumentScoreHistoryResponse,
  IssueSeverityFilter,
  PaginatedResponse,
  DocumentHealthResponse,
  SetDocumentReviewDateRequest,
  SortDirection,
} from '@sph/types';

const SEVERITY_VALUES: IssueSeverityFilter[] = ['NeedsAttention', 'RequiresReview'];
import { EntraJwtGuard } from '../auth/entra-jwt.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';
import { OrganizationAccessGuard } from '../common/organization-access.guard';
import { DocumentsService } from './documents.service';

const SORT_BY_VALUES: DocumentHealthSortBy[] = ['score', 'name', 'lastModified'];
const SORT_DIR_VALUES: SortDirection[] = ['asc', 'desc'];

@Controller('organizations/:id')
@UseGuards(EntraJwtGuard, TenantContextGuard, OrganizationAccessGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Get('documents')
  async listDocuments(@Param('id') organizationId: string): Promise<DocumentResponse[]> {
    return this.documentsService.listDocuments(organizationId);
  }

  @Get('documents/:documentId')
  async getDocument(
    @Param('id') organizationId: string,
    @Param('documentId') documentId: string,
  ): Promise<DocumentDetailResponse> {
    const document = await this.documentsService.getDocument(organizationId, documentId);
    if (!document) throw new NotFoundException('Document not found');
    return document;
  }

  @Get('documents/:documentId/history')
  async getDocumentHistory(
    @Param('id') organizationId: string,
    @Param('documentId') documentId: string,
  ): Promise<DocumentScoreHistoryResponse> {
    const history = await this.documentsService.getDocumentHistory(organizationId, documentId);
    if (!history) throw new NotFoundException('Document not found');
    return history;
  }

  @Get('documents/:documentId/owners')
  async listOwners(
    @Param('id') organizationId: string,
    @Param('documentId') documentId: string,
  ): Promise<DocumentOwnerResponse[]> {
    const owners = await this.documentsService.listOwners(organizationId, documentId);
    if (!owners) throw new NotFoundException('Document not found');
    return owners;
  }

  @Post('documents/:documentId/owners')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'GovernanceManager')
  async assignOwner(
    @Param('id') organizationId: string,
    @Param('documentId') documentId: string,
    @CurrentUser() user: User,
    @Body() body: AssignDocumentOwnerRequest,
  ): Promise<DocumentOwnerResponse> {
    if (!body?.displayName && !body?.email) {
      throw new BadRequestException('At least one of displayName or email must be provided');
    }
    const owner = await this.documentsService.assignOwner(organizationId, documentId, user.id, body);
    if (!owner) throw new NotFoundException('Document not found');
    return owner;
  }

  @Delete('documents/:documentId/owners/:ownerId')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'GovernanceManager')
  @HttpCode(204)
  async removeOwner(
    @Param('id') organizationId: string,
    @Param('documentId') documentId: string,
    @Param('ownerId') ownerId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.documentsService.removeOwner(organizationId, documentId, ownerId, user.id);
  }

  // ADR-0016 §4.6/§7: same mutation-permission tier as owner assignment —
  // Admin or GovernanceManager, never Member.
  @Patch('documents/:documentId/review')
  @UseGuards(RolesGuard)
  @Roles('Admin', 'GovernanceManager')
  async setReviewDate(
    @Param('id') organizationId: string,
    @Param('documentId') documentId: string,
    @Body() body: SetDocumentReviewDateRequest,
  ): Promise<DocumentReviewResponse> {
    const nextReviewDueAt = this.parseReviewDate(body?.nextReviewDueAt ?? null);
    const result = await this.documentsService.setReviewDate(organizationId, documentId, nextReviewDueAt);
    if (!result) throw new NotFoundException('Document not found');
    return result;
  }

  private parseReviewDate(value: string | null): string | null {
    if (value === null) return null;
    if (Number.isNaN(new Date(value).getTime())) {
      throw new BadRequestException('nextReviewDueAt must be a valid ISO date string or null');
    }
    return value;
  }

  @Get('document-health')
  async listDocumentHealth(
    @Param('id') organizationId: string,
    @Query() query: Record<string, string>,
  ): Promise<PaginatedResponse<DocumentHealthResponse>> {
    return this.documentsService.listDocumentHealth(organizationId, this.parseQuery(query));
  }

  private parseQuery(query: Record<string, string>): DocumentHealthQuery {
    const page = query.page ? Number(query.page) : undefined;
    const pageSize = query.pageSize ? Number(query.pageSize) : undefined;
    const minScore = query.minScore ? Number(query.minScore) : undefined;
    const maxScore = query.maxScore ? Number(query.maxScore) : undefined;

    if (page !== undefined && (!Number.isInteger(page) || page < 1)) {
      throw new BadRequestException('page must be a positive integer');
    }
    if (pageSize !== undefined && (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100)) {
      throw new BadRequestException('pageSize must be an integer between 1 and 100');
    }
    if (query.sortBy !== undefined && !SORT_BY_VALUES.includes(query.sortBy as DocumentHealthSortBy)) {
      throw new BadRequestException(`sortBy must be one of: ${SORT_BY_VALUES.join(', ')}`);
    }
    if (query.sortDir !== undefined && !SORT_DIR_VALUES.includes(query.sortDir as SortDirection)) {
      throw new BadRequestException(`sortDir must be one of: ${SORT_DIR_VALUES.join(', ')}`);
    }
    if (query.severity !== undefined && !SEVERITY_VALUES.includes(query.severity as IssueSeverityFilter)) {
      throw new BadRequestException('severity must be one of: NeedsAttention, RequiresReview');
    }
    if (minScore !== undefined && (Number.isNaN(minScore) || minScore < 0 || minScore > 100)) {
      throw new BadRequestException('minScore must be a number between 0 and 100');
    }
    if (maxScore !== undefined && (Number.isNaN(maxScore) || maxScore < 0 || maxScore > 100)) {
      throw new BadRequestException('maxScore must be a number between 0 and 100');
    }
    if (minScore !== undefined && maxScore !== undefined && minScore > maxScore) {
      throw new BadRequestException('minScore cannot be greater than maxScore');
    }

    return {
      page,
      pageSize,
      sortBy: query.sortBy as DocumentHealthSortBy | undefined,
      sortDir: query.sortDir as SortDirection | undefined,
      severity: query.severity as IssueSeverityFilter | undefined,
      siteId: query.siteId,
      minScore,
      maxScore,
    };
  }
}
