'use client';

import { useCallback, useState } from 'react';
import type { CreateRemediationJobRequest, CreateRemediationJobResponse } from '@sph/types';
import { useCurrentUser } from '@/lib/auth/current-user-context';
import { useAccessToken } from '@/lib/auth/use-access-token';
import { createRemediationJob } from '../endpoints';

interface UseCreateRemediationJobResult {
  submit: (body: CreateRemediationJobRequest) => Promise<CreateRemediationJobResponse | undefined>;
  submitting: boolean;
  submitError: Error | undefined;
}

// P0-6 (ADR-0022 Phase 7): same shape as useConfirmReviewDateMapping/
// useDocumentReviewDate — no optimistic update (creating a bulk remediation
// job is exactly the kind of write those two hooks' own comments already
// call out: not a quick, near-certain-to-succeed status flip), so the
// caller waits for the real response and gets `undefined` back on failure,
// never a false success.
export function useCreateRemediationJob(): UseCreateRemediationJobResult {
  const { user } = useCurrentUser();
  const getAccessToken = useAccessToken();
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<Error>();

  const submit = useCallback(
    async (body: CreateRemediationJobRequest) => {
      if (!user) return undefined;
      setSubmitting(true);
      setSubmitError(undefined);
      try {
        const token = await getAccessToken();
        return await createRemediationJob(user.organizationId, token, body);
      } catch (caught) {
        setSubmitError(caught instanceof Error ? caught : new Error(String(caught)));
        return undefined;
      } finally {
        setSubmitting(false);
      }
    },
    [user, getAccessToken],
  );

  return { submit, submitting, submitError };
}
