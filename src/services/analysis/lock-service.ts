import { getServerEnv } from "@/src/lib/env";
import { createServiceRoleSupabaseClient } from "@/src/services/_shared/supabase";

export async function acquireRepositoryProcessingLock(input: {
  repositoryId: string;
  runId: string;
  workerId: string;
}) {
  const supabase = createServiceRoleSupabaseClient();
  const env = getServerEnv();
  const { data, error } = await supabase.rpc("acquire_repository_processing_lock", {
    target_repository_id: input.repositoryId,
    target_run_id: input.runId,
    target_worker_id: input.workerId,
    lease_seconds: env.ANALYSIS_LOCK_LEASE_SECONDS,
  });

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

export async function renewRepositoryProcessingLock(input: {
  repositoryId: string;
  runId: string;
  workerId: string;
}) {
  const supabase = createServiceRoleSupabaseClient();
  const env = getServerEnv();
  const { data, error } = await supabase.rpc("renew_repository_processing_lock", {
    target_repository_id: input.repositoryId,
    target_run_id: input.runId,
    target_worker_id: input.workerId,
    lease_seconds: env.ANALYSIS_LOCK_LEASE_SECONDS,
  });

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

export async function releaseRepositoryProcessingLock(input: {
  repositoryId: string;
  runId: string;
  workerId: string;
}) {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.rpc("release_repository_processing_lock", {
    target_repository_id: input.repositoryId,
    target_run_id: input.runId,
    target_worker_id: input.workerId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}
