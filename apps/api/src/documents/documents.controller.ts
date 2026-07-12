import { BadRequestException, Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import type {
  DocumentDetailResponse,
  DocumentHealthQuery,
  DocumentHealthSortBy,
  DocumentResponse,
  IssueSeverityFilter,
  PaginatedResponse,
  DocumentHealthResponse,
  SortDirection,
} from '@sph/types';

const SEVERITY_VALUES: IssueSeverityFilter[] = ['NeedsAttention', 'RequiresReview'];
import { EntraJwtGuard } from '../auth/entra-jwt.guard';
import { TenantContextGuard } from '../auth/tenant-context.guard';
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
