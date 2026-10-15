-- Additive indexes only. Preserve the thirty-day retention and all queue rules.
CREATE INDEX print_jobs_terminal_expiry_idx
  ON print_jobs (business_id, COALESCE(processed_at, discarded_at, created_at))
  WHERE status IN ('printed', 'discarded');

CREATE INDEX print_jobs_printed_time_idx
  ON print_jobs (business_id, COALESCE(processed_at, created_at))
  WHERE status = 'printed';

-- Include every non-terminal status, including legacy/future states.
CREATE INDEX print_jobs_nonterminal_idx
  ON print_jobs (business_id, status)
  WHERE status NOT IN ('printed', 'discarded');
