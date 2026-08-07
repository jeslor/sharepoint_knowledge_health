/**
 * The 30 synthetic documents seeded into the demo SharePoint site, and
 * exactly why each one scores the way it does under the REAL scoring
 * algorithm (@sph/scoring) — nothing here hand-picks a score or issue
 * directly. Every field below is realistic metadata; calculate-score.ts
 * decides the rest, exactly as apps/worker's real scoring pass does.
 *
 * Category → which of the 6 real ScoringCriterion values it isolates
 * (packages/scoring/src/rules/*.ts):
 * - healthy:    none — recent, owned, review date set, unique, real name
 * - noOwner:    Ownership   ("Missing owner" — no DocumentOwner row)
 * - noReview:   ReviewStatus ("Expired review date" — nextReviewDueAt null)
 * - stale:      Freshness   ("Stale document" — not modified in a long time)
 * - old:        Age         (created long ago, but recently touched —
 *                            isolates Age from Freshness on purpose)
 * - duplicate:  Duplication (name+size collides with a sibling)
 * - placeholder: Metadata   ("Broken reference" has no real equivalent in
 *                            this product's 6 real criteria — Metadata's
 *                            placeholder-name heuristic is the closest
 *                            actual signal, substituted deliberately and
 *                            documented here, not silently reinterpreted)
 * - critical:   multiple criteria at once, landing in RequiresReview
 */

export type DocPlanCategory = 'healthy' | 'noOwner' | 'noReview' | 'stale' | 'old' | 'duplicate' | 'placeholder' | 'critical';

export interface DocPlan {
  seq: number;
  name: string;
  fileType: string;
  sizeBytes: number;
  category: DocPlanCategory;
  /** Days before "now" the document was created (sourceCreatedAt). */
  createdDaysAgo: number;
  /** Days before "now" the document was last modified (sourceModifiedAt). */
  modifiedDaysAgo: number;
  hasOwner: boolean;
  hasReviewDate: boolean;
  /** Only set for duplicate pairs — documents sharing this key get identical name+size. */
  duplicateGroup?: string;
}

export const DOCUMENT_PLAN: DocPlan[] = [
  // Healthy (6) — recent, owned, review date set, unique, nothing to flag.
  { seq: 1, name: 'Q3 2026 Board Presentation.pptx', fileType: 'pptx', sizeBytes: 4_200_000, category: 'healthy', createdDaysAgo: 120, modifiedDaysAgo: 5, hasOwner: true, hasReviewDate: true },
  { seq: 2, name: 'Employee Handbook 2026.docx', fileType: 'docx', sizeBytes: 850_000, category: 'healthy', createdDaysAgo: 200, modifiedDaysAgo: 12, hasOwner: true, hasReviewDate: true },
  { seq: 3, name: 'Vendor Security Assessment - Acme Corp.pdf', fileType: 'pdf', sizeBytes: 1_100_000, category: 'healthy', createdDaysAgo: 90, modifiedDaysAgo: 3, hasOwner: true, hasReviewDate: true },
  { seq: 4, name: 'Product Roadmap H2 2026.xlsx', fileType: 'xlsx', sizeBytes: 320_000, category: 'healthy', createdDaysAgo: 60, modifiedDaysAgo: 1, hasOwner: true, hasReviewDate: true },
  { seq: 5, name: 'Customer Onboarding Playbook.docx', fileType: 'docx', sizeBytes: 690_000, category: 'healthy', createdDaysAgo: 150, modifiedDaysAgo: 20, hasOwner: true, hasReviewDate: true },
  { seq: 6, name: 'Incident Response Runbook.docx', fileType: 'docx', sizeBytes: 540_000, category: 'healthy', createdDaysAgo: 100, modifiedDaysAgo: 8, hasOwner: true, hasReviewDate: true },

  // Ownership issues — no identifiable owner (4).
  { seq: 7, name: 'Marketing Campaign Assets Q1.pptx', fileType: 'pptx', sizeBytes: 8_400_000, category: 'noOwner', createdDaysAgo: 80, modifiedDaysAgo: 10, hasOwner: false, hasReviewDate: true },
  { seq: 8, name: 'Legacy Vendor Contracts Archive.xlsx', fileType: 'xlsx', sizeBytes: 1_600_000, category: 'noOwner', createdDaysAgo: 140, modifiedDaysAgo: 15, hasOwner: false, hasReviewDate: true },
  { seq: 9, name: 'Regional Sales Data Export.csv', fileType: 'csv', sizeBytes: 210_000, category: 'noOwner', createdDaysAgo: 45, modifiedDaysAgo: 6, hasOwner: false, hasReviewDate: true },
  { seq: 10, name: 'IT Asset Inventory 2025.xlsx', fileType: 'xlsx', sizeBytes: 480_000, category: 'noOwner', createdDaysAgo: 110, modifiedDaysAgo: 18, hasOwner: false, hasReviewDate: true },

  // ReviewStatus issues — no scheduled review date (4).
  { seq: 11, name: 'Data Retention Policy.docx', fileType: 'docx', sizeBytes: 310_000, category: 'noReview', createdDaysAgo: 130, modifiedDaysAgo: 9, hasOwner: true, hasReviewDate: false },
  { seq: 12, name: 'Third-Party Risk Register.xlsx', fileType: 'xlsx', sizeBytes: 560_000, category: 'noReview', createdDaysAgo: 95, modifiedDaysAgo: 14, hasOwner: true, hasReviewDate: false },
  { seq: 13, name: 'Business Continuity Plan.docx', fileType: 'docx', sizeBytes: 720_000, category: 'noReview', createdDaysAgo: 160, modifiedDaysAgo: 22, hasOwner: true, hasReviewDate: false },
  { seq: 14, name: 'Information Security Policy.docx', fileType: 'docx', sizeBytes: 410_000, category: 'noReview', createdDaysAgo: 105, modifiedDaysAgo: 11, hasOwner: true, hasReviewDate: false },

  // Freshness issues — stale, not modified in a long time (4). 300-500 days
  // since modification comfortably clears FULL_SCORE_DAYS=90 and lands
  // well below ISSUE_THRESHOLD=70 (linear decay to 0 at 730 days).
  { seq: 15, name: '2023 Annual Report Draft.docx', fileType: 'docx', sizeBytes: 980_000, category: 'stale', createdDaysAgo: 520, modifiedDaysAgo: 480, hasOwner: true, hasReviewDate: true },
  { seq: 16, name: 'Old Office Floor Plans.pdf', fileType: 'pdf', sizeBytes: 2_300_000, category: 'stale', createdDaysAgo: 400, modifiedDaysAgo: 380, hasOwner: true, hasReviewDate: true },
  { seq: 17, name: 'Discontinued Product Specs.docx', fileType: 'docx', sizeBytes: 610_000, category: 'stale', createdDaysAgo: 350, modifiedDaysAgo: 340, hasOwner: true, hasReviewDate: true },
  { seq: 18, name: 'Archived Project Charter - Phoenix.docx', fileType: 'docx', sizeBytes: 290_000, category: 'stale', createdDaysAgo: 460, modifiedDaysAgo: 420, hasOwner: true, hasReviewDate: true },

  // Age issues — old since creation, but recently touched, isolating Age
  // from Freshness (FULL_SCORE_DAYS=365 for Age; modifiedDaysAgo stays
  // well under Freshness's own 90-day threshold).
  { seq: 19, name: 'Master Services Agreement Template.docx', fileType: 'docx', sizeBytes: 180_000, category: 'old', createdDaysAgo: 1100, modifiedDaysAgo: 20, hasOwner: true, hasReviewDate: true },
  { seq: 20, name: 'Standard Operating Procedures - Facilities.docx', fileType: 'docx', sizeBytes: 340_000, category: 'old', createdDaysAgo: 1300, modifiedDaysAgo: 30, hasOwner: true, hasReviewDate: true },
  { seq: 21, name: 'Original Company Bylaws.pdf', fileType: 'pdf', sizeBytes: 220_000, category: 'old', createdDaysAgo: 1500, modifiedDaysAgo: 45, hasOwner: true, hasReviewDate: true },

  // Duplication — two matching pairs (4 documents, identical name+size
  // within each pair — packages/scoring's exact-match rule, ADR-0005).
  { seq: 22, name: 'Expense Report Template.xlsx', fileType: 'xlsx', sizeBytes: 95_000, category: 'duplicate', createdDaysAgo: 200, modifiedDaysAgo: 40, hasOwner: true, hasReviewDate: true, duplicateGroup: 'expense-template' },
  { seq: 23, name: 'Expense Report Template.xlsx', fileType: 'xlsx', sizeBytes: 95_000, category: 'duplicate', createdDaysAgo: 60, modifiedDaysAgo: 25, hasOwner: true, hasReviewDate: true, duplicateGroup: 'expense-template' },
  { seq: 24, name: 'Meeting Notes Template.docx', fileType: 'docx', sizeBytes: 42_000, category: 'duplicate', createdDaysAgo: 250, modifiedDaysAgo: 35, hasOwner: true, hasReviewDate: true, duplicateGroup: 'meeting-notes' },
  { seq: 25, name: 'Meeting Notes Template.docx', fileType: 'docx', sizeBytes: 42_000, category: 'duplicate', createdDaysAgo: 30, modifiedDaysAgo: 5, hasOwner: true, hasReviewDate: true, duplicateGroup: 'meeting-notes' },

  // Metadata — placeholder-looking names (packages/scoring's
  // PLACEHOLDER_NAME_PATTERNS: ^untitled, ^new document, ^copy of).
  { seq: 26, name: 'Untitled Document.docx', fileType: 'docx', sizeBytes: 15_000, category: 'placeholder', createdDaysAgo: 40, modifiedDaysAgo: 38, hasOwner: true, hasReviewDate: true },
  { seq: 27, name: 'New Document.docx', fileType: 'docx', sizeBytes: 12_000, category: 'placeholder', createdDaysAgo: 25, modifiedDaysAgo: 24, hasOwner: true, hasReviewDate: true },
  { seq: 28, name: 'Copy of Employee List.xlsx', fileType: 'xlsx', sizeBytes: 68_000, category: 'placeholder', createdDaysAgo: 15, modifiedDaysAgo: 14, hasOwner: true, hasReviewDate: true },

  // Critical — multiple problems at once, landing in RequiresReview.
  { seq: 29, name: 'Terminated Employee Records - Archive.xlsx', fileType: 'xlsx', sizeBytes: 340_000, category: 'critical', createdDaysAgo: 600, modifiedDaysAgo: 550, hasOwner: false, hasReviewDate: false },
  { seq: 30, name: 'Draft Legal Settlement (2022).docx', fileType: 'docx', sizeBytes: 210_000, category: 'critical', createdDaysAgo: 1400, modifiedDaysAgo: 900, hasOwner: false, hasReviewDate: false },
];
