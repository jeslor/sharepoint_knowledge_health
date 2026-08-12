// Public surface of @sph/graph-client. Everything exported here must be
// describable without reference to SharePoint Knowledge Health as a
// product (ADR-0013 §9) — DTOs, read-only Graph operations, and typed
// errors only. No Prisma, no database, no queue, no business rules.

export type {
  GraphSite,
  GraphDrive,
  GraphDriveItem,
  GraphColumnDefinition,
  GraphContentType,
  GraphListItemWithFields,
  GraphListItemDriveItemRef,
} from './dto';
export type { ListOptions } from './types';
export type { GraphClientLogger } from './logger';
export { noopLogger } from './logger';

export {
  GraphClientError,
  GraphAuthenticationError,
  GraphPermissionError,
  GraphNotFoundError,
  GraphThrottledError,
  GraphTransientError,
  GraphUnexpectedError,
} from './errors';

export { listSites, getSite } from './sites';
export { listDrives, getDrive } from './drives';
export { listDocuments, getDocument, listChildren } from './documents';
export { listColumns, listContentTypes } from './columns';
export { listItemFields, listItemDriveItemIds } from './list-items';
