// Public surface of @sph/graph-client. Everything exported here must be
// describable without reference to SharePoint Knowledge Health as a
// product (ADR-0013 §9) — DTOs, Graph operations, and typed errors only.
// No Prisma, no database, no queue, no business rules. Almost entirely
// read-only by design; `updateListItemFields` is the one narrow, explicit
// exception (ADR-0013's 2026-08-13 amendment) — it does not reverse the
// rule, and no other write function should be added without the same
// deliberate, ADR-recorded justification.

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
export { listDocuments, getDocument, listChildren, updateListItemFields } from './documents';
export { listColumns, listContentTypes } from './columns';
export { listItemFields, listItemDriveItemIds } from './list-items';
