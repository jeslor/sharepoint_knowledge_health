import type { GovernanceIssueTypeValue } from '@sph/types';

// Static, deliberately small — not a generic remediation framework. Plain
// English only; never invents organization-specific policy or exact steps
// the application doesn't actually know. `remediation` says where the fix
// happens: two criteria have an in-app control, the other four only ever
// get fixed in SharePoint itself (ADR-0003's read-only Graph boundary).
export type IssueRemediationKind = 'ownership' | 'reviewDate' | 'external';

export interface IssueGuidance {
  text: string;
  remediation: IssueRemediationKind;
}

export const ISSUE_GUIDANCE: Record<GovernanceIssueTypeValue, IssueGuidance> = {
  Ownership: {
    text: 'This document does not have an identifiable owner. Assign an owner to resolve this issue.',
    remediation: 'ownership',
  },
  ReviewStatus: {
    text: 'This document has no scheduled review date. Set a review date to resolve this issue.',
    remediation: 'reviewDate',
  },
  Freshness: {
    text: 'This document has not been modified recently enough according to the configured health rule. Review and update the document in SharePoint.',
    remediation: 'external',
  },
  Age: {
    text: "This document has exceeded the configured age threshold. Review it for continued relevance or archive it according to your organization's process.",
    remediation: 'external',
  },
  Duplication: {
    text: "This document appears to have a duplicate. Compare, consolidate, or remove the unnecessary copy according to your organization's process.",
    remediation: 'external',
  },
  Metadata: {
    text: 'Required document metadata is incomplete or incorrect. Correct the relevant metadata in SharePoint.',
    remediation: 'external',
  },
  Taxonomy: {
    text: "This document is missing one or more of your organization's designated classification fields. Populate the classification columns for this document in SharePoint.",
    remediation: 'external',
  },
};
