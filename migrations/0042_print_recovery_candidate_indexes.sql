-- Additive only: no queue, attempt, audit or historical data is changed.
-- The time/status range starts with this tenant's unresolved attempts.
CREATE INDEX print_job_attempts_unresolved_status_idx
  ON print_job_attempts (business_id, status, submission_started_at, job_id)
  WHERE resolution IS NULL;

-- Correlated safety checks and station attribution must look up one job,
-- never all attempts belonging to the tenant.
CREATE INDEX print_job_attempts_job_lookup_idx
  ON print_job_attempts (business_id, job_id, attempt_number DESC);
