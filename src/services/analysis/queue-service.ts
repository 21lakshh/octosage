import { getServerEnv } from "@/src/lib/env";
import { createServiceRoleSupabaseClient } from "@/src/services/_shared/supabase";
import type { Json } from "@/src/types/database";

export interface OwnershipAnalysisQueueMessage {
  run_id: string;
  repository_id: string;
  user_id: string;
  attempt: number;
}

export interface QueueEnvelope {
  msgId: number;
  readCount: number;
  enqueuedAt: string;
  visibilityTimeoutAt: string;
  message: OwnershipAnalysisQueueMessage;
}

export async function enqueueOwnershipAnalysisJob(message: OwnershipAnalysisQueueMessage, delaySeconds = 0) {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.rpc("enqueue_ownership_analysis_job", {
    payload: message as unknown as Json,
    delay_seconds: delaySeconds,
  });

  if (error) {
    throw new Error(error.message);
  }

  return Number(data);
}

export async function readOwnershipAnalysisJobs(quantity = 1): Promise<QueueEnvelope[]> {
  const supabase = createServiceRoleSupabaseClient();
  const env = getServerEnv();
  const { data, error } = await supabase.rpc("read_ownership_analysis_jobs", {
    vt_seconds: env.ANALYSIS_QUEUE_VT_SECONDS,
    qty: quantity,
    max_poll_seconds: env.ANALYSIS_QUEUE_POLL_SECONDS,
  });

  if (error) {
    throw new Error(error.message);
  }

  return ((data ?? []) as unknown as Array<{
    msg_id: number;
    read_ct: number;
    enqueued_at: string;
    vt: string;
    message: OwnershipAnalysisQueueMessage;
  }>).map((row) => ({
    msgId: row.msg_id,
    readCount: row.read_ct,
    enqueuedAt: row.enqueued_at,
    visibilityTimeoutAt: row.vt,
    message: row.message,
  }));
}

export async function deleteOwnershipAnalysisJob(messageId: number) {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.rpc("delete_ownership_analysis_job", {
    target_msg_id: messageId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

export async function archiveOwnershipAnalysisJob(messageId: number) {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase.rpc("archive_ownership_analysis_job", {
    target_msg_id: messageId,
  });

  if (error) {
    throw new Error(error.message);
  }

  return Boolean(data);
}

export async function extendOwnershipAnalysisJobVisibility(messageId: number) {
  const supabase = createServiceRoleSupabaseClient();
  const env = getServerEnv();
  const { error } = await supabase.rpc("extend_ownership_analysis_job_visibility", {
    target_msg_id: messageId,
    vt_seconds: env.ANALYSIS_QUEUE_VT_SECONDS,
  });

  if (error) {
    throw new Error(error.message);
  }
}
