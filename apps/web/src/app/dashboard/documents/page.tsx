'use client';

import { Suspense, useCallback, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { DocumentHealthQuery, IssueSeverityFilter, SortDirection } from '@sph/types';
import { DocumentHealthTable, isReviewStatusCandidate } from '@/components/documents/document-health-table';
import { DocumentFilters, type DocumentFilterValues } from '@/components/documents/document-filters';
import { RemediationConfirmDialog } from '@/components/documents/remediation-confirm-dialog';
import { BulkActionToolbar } from '@/components/ui/bulk-action-toolbar';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { Pagination } from '@/components/ui/pagination';
import { LoadingState, ErrorState } from '@/components/ui/query-state';
import { Toast } from '@/components/ui/toast';
import { useCreateRemediationJob } from '@/lib/api/hooks/use-create-remediation-job';
import { useDocumentHealth } from '@/lib/api/hooks/use-document-health';
import { useSharePointSites } from '@/lib/api/hooks/use-sharepoint-sites';

function DocumentsPageContent(): JSX.Element {
  const router = useRouter();
  const searchParams = useSearchParams();

  const query: DocumentHealthQuery = useMemo(
    () => ({
      page: searchParams.get('page') ? Number(searchParams.get('page')) : undefined,
      sortBy: 'score',
      sortDir: (searchParams.get('sortDir') as SortDirection | null) ?? undefined,
      severity: (searchParams.get('severity') as IssueSeverityFilter | null) ?? undefined,
      siteId: searchParams.get('siteId') ?? undefined,
      minScore: searchParams.get('minScore') ? Number(searchParams.get('minScore')) : undefined,
      maxScore: searchParams.get('maxScore') ? Number(searchParams.get('maxScore')) : undefined,
    }),
    [searchParams],
  );

  const { data, loading, error } = useDocumentHealth(query);
  const { data: sites } = useSharePointSites();

  // P0-5 (ADR-0022 Phase 7): kept local to this page rather than a new
  // global store — a plain Set survives pagination/filtering on its own
  // (it's just never cleared when `data` changes), which is exactly the
  // behavior bulk selection across up to 500 documents needs.
  const [selectedDocumentIds, setSelectedDocumentIds] = useState<Set<string>>(new Set());

  const eligibleVisibleDocumentIds = useMemo(
    () => (data ? data.data.filter(isReviewStatusCandidate).map((document) => document.documentId) : []),
    [data],
  );

  const handleToggleDocument = useCallback((documentId: string) => {
    setSelectedDocumentIds((current) => {
      const next = new Set(current);
      if (next.has(documentId)) next.delete(documentId);
      else next.add(documentId);
      return next;
    });
  }, []);

  const handleToggleSelectAllEligible = useCallback(() => {
    setSelectedDocumentIds((current) => {
      const allSelected =
        eligibleVisibleDocumentIds.length > 0 && eligibleVisibleDocumentIds.every((id) => current.has(id));
      const next = new Set(current);
      for (const id of eligibleVisibleDocumentIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, [eligibleVisibleDocumentIds]);

  const handleClearSelection = useCallback(() => setSelectedDocumentIds(new Set()), []);

  // P0-6 (ADR-0022 Phase 7): the confirmation dialog + submission flow.
  const [isRemediationDialogOpen, setIsRemediationDialogOpen] = useState(false);
  const [remediationToast, setRemediationToast] = useState<string | undefined>();
  const { submit: submitRemediationJob, submitting: submittingRemediationJob, submitError: remediationSubmitError } =
    useCreateRemediationJob();

  const handleRemediateSelected = useCallback(() => {
    setIsRemediationDialogOpen(true);
  }, []);

  const handleConfirmRemediation = useCallback(
    async (nextReviewDueAt: string) => {
      const documentIds = Array.from(selectedDocumentIds);
      const result = await submitRemediationJob({ issueType: 'ReviewStatus', documentIds, nextReviewDueAt });
      // A failed submission leaves remediationSubmitError set — the dialog
      // stays open and shows it inline (RemediationConfirmDialog), rather
      // than closing on a call this hook itself reports as unsuccessful.
      if (!result) return;

      setIsRemediationDialogOpen(false);
      setSelectedDocumentIds(new Set());
      setRemediationToast(
        `Remediation started for ${result.totalCount} document${result.totalCount === 1 ? '' : 's'}.`,
      );
    },
    [selectedDocumentIds, submitRemediationJob],
  );

  const updateParams = useCallback(
    (updates: Record<string, string | number | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined || value === '') params.delete(key);
        else params.set(key, String(value));
      }
      router.push(`/dashboard/documents?${params.toString()}`);
    },
    [router, searchParams],
  );

  const handleFilterChange = useCallback(
    (values: DocumentFilterValues) => {
      updateParams({ ...values, page: 1 });
    },
    [updateParams],
  );

  const handleToggleScoreSort = useCallback(() => {
    updateParams({ sortDir: query.sortDir === 'asc' ? 'desc' : 'asc' });
  }, [updateParams, query.sortDir]);

  return (
    <div className="space-y-6">
      <PageHeader title="Document health" />
      <DocumentFilters
        values={{ severity: query.severity, siteId: query.siteId, minScore: query.minScore, maxScore: query.maxScore }}
        sites={sites ?? []}
        onChange={handleFilterChange}
      />
      <BulkActionToolbar selectedCount={selectedDocumentIds.size} onClearSelection={handleClearSelection}>
        <Button onClick={handleRemediateSelected}>Remediate review status</Button>
      </BulkActionToolbar>
      {loading && <LoadingState label="Loading documents…" />}
      {error && <ErrorState error={error} />}
      {data && (
        <>
          <DocumentHealthTable
            documents={data.data}
            sortDir={query.sortDir ?? 'asc'}
            onToggleScoreSort={handleToggleScoreSort}
            selectedDocumentIds={selectedDocumentIds}
            onToggleDocument={handleToggleDocument}
            onToggleSelectAllEligible={handleToggleSelectAllEligible}
          />
          <Pagination pagination={data.pagination} onPageChange={(page) => updateParams({ page })} />
        </>
      )}

      <RemediationConfirmDialog
        open={isRemediationDialogOpen}
        onOpenChange={setIsRemediationDialogOpen}
        selectedCount={selectedDocumentIds.size}
        onConfirm={(nextReviewDueAt) => void handleConfirmRemediation(nextReviewDueAt)}
        submitting={submittingRemediationJob}
        submitError={remediationSubmitError}
      />
      {remediationToast && <Toast message={remediationToast} onDismiss={() => setRemediationToast(undefined)} />}
    </div>
  );
}

export default function DocumentsPage(): JSX.Element {
  return (
    <Suspense fallback={<LoadingState />}>
      <DocumentsPageContent />
    </Suspense>
  );
}
