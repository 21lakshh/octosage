import { buildOwnershipAnalysis } from "@/src/lib/analysis/ownership";
import { getServerEnv } from "@/src/lib/env";
import { fetchRecentCommitActivity, fetchRepositoryTree } from "@/src/integrations/github/service";
import { getConnectedGitHubAccountForUser } from "@/src/services/auth/service";
import { classifyAnalysisError } from "@/src/services/analysis/error-service";
import { filterRelevantCodePaths, isRelevantCodeFile } from "@/src/services/analysis/file-filter-service";
import { acquireRepositoryProcessingLock, releaseRepositoryProcessingLock, renewRepositoryProcessingLock } from "@/src/services/analysis/lock-service";
import { FULL_HISTORY_WINDOW_START, selectAnalysisMode } from "@/src/services/analysis/mode-service";
import {
  archiveOwnershipAnalysisJob,
  deleteOwnershipAnalysisJob,
  enqueueOwnershipAnalysisJob,
  extendOwnershipAnalysisJobVisibility,
  readOwnershipAnalysisJobs,
  type QueueEnvelope,
} from "@/src/services/analysis/queue-service";
import { createServiceRoleSupabaseClient } from "@/src/services/_shared/supabase";
import { getRepositoryForUser } from "@/src/services/repositories/service";
import type { Database } from "@/src/types/database";

const DEFAULT_COMMIT_LIMIT = 1_000;
const DEFAULT_MAX_ATTEMPTS = 3;

type AnalysisRunRow = Database["public"]["Tables"]["analysis_runs"]["Row"];
type AnalysisSnapshotRow = Database["public"]["Tables"]["analysis_snapshots"]["Row"];
type RunStatus = AnalysisRunRow["status"];

function nowIso() {
  return new Date().toISOString();
}

async function updateRun(
  runId: string,
  patch: Database["public"]["Tables"]["analysis_runs"]["Update"],
): Promise<AnalysisRunRow> {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase
    .from("analysis_runs")
    .update({
      ...patch,
      updated_at: nowIso(),
    })
    .eq("id", runId)
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as AnalysisRunRow;
}

async function getAnalysisRunById(runId: string) {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase
    .from("analysis_runs")
    .select("*")
    .eq("id", runId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as AnalysisRunRow | null) ?? null;
}

function calculateProgressFromCommitProcessing(processed: number, total: number) {
  if (total <= 0) {
    return 30;
  }

  const ratio = processed / total;
  return Math.min(80, 30 + Math.round(ratio * 50));
}

function shouldPersistCommitProgress(processedCount: number, totalCount: number) {
  const batchSize = getServerEnv().ANALYSIS_PROGRESS_BATCH_SIZE;
  return processedCount === totalCount || processedCount === 1 || processedCount % batchSize === 0;
}

async function updateRunProgress(input: {
  runId: string;
  progressPhase: string;
  progressPct: number;
  processedCommitCount?: number;
  selectedCommitCount?: number;
}) {
  await updateRun(input.runId, {
    progress_phase: input.progressPhase,
    progress_pct: input.progressPct,
    processed_commit_count: input.processedCommitCount,
    selected_commit_count: input.selectedCommitCount,
  });
}

async function getRepositoryAndTokenForRun(run: AnalysisRunRow) {
  const repository = await getRepositoryForUser(run.user_id, run.repository_id);

  if (!repository) {
    throw new Error("Repository missing for analysis run.");
  }

  const connectedAccount = await getConnectedGitHubAccountForUser(run.user_id);

  if (!connectedAccount) {
    throw new Error("GitHub account not connected.");
  }

  return {
    repository,
    accessToken: connectedAccount.accessToken,
  };
}

async function persistAnalysisSnapshot(input: {
  run: AnalysisRunRow;
  analysisMode: "full" | "reduced" | "degraded";
  degradedReason: string | null;
  treeFileCount: number;
  commitCountProcessed: number;
  analysis: ReturnType<typeof buildOwnershipAnalysis>;
}) {
  const supabase = createServiceRoleSupabaseClient();
  const { data: snapshot, error: snapshotError } = await supabase
    .from("analysis_snapshots")
    .insert({
      user_id: input.run.user_id,
      repository_id: input.run.repository_id,
      analysis_run_id: input.run.id,
      analysis_mode: input.analysisMode,
      commit_count_processed: input.commitCountProcessed,
      tree_file_count: input.treeFileCount,
      degraded_reason: input.degradedReason,
      high_risk_modules: input.analysis.summary.highRiskModules,
      healthy_modules: input.analysis.summary.healthyModules,
      leading_owner_coverage: input.analysis.summary.leadingOwnerCoverage,
      node_count: input.analysis.details.length,
    })
    .select("*")
    .single();

  if (snapshotError) {
    throw new Error(snapshotError.message);
  }

  const snapshotRow = snapshot as AnalysisSnapshotRow;
  const nodeRows = input.analysis.details.map((node) => ({
    snapshot_id: snapshotRow.id,
    path: node.path,
    label: node.label,
    node_type: node.nodeType,
    depth: node.depth,
    parent_path: node.parentPath,
    leading_owner_id: node.leadingOwnerId,
    leading_owner_share: node.leadingOwnerShare,
    bus_factor: node.busFactor,
    risk_level: node.riskLevel,
    raw_score_total: node.rawScoreTotal,
    file_count: node.fileCount,
    owner_count: node.ownerCount,
  }));

  if (nodeRows.length) {
    const { error } = await supabase.from("analysis_nodes").insert(nodeRows);

    if (error) {
      throw new Error(error.message);
    }
  }

  const ownerRows = input.analysis.details.flatMap((node) =>
    node.owners.map((owner) => ({
      snapshot_id: snapshotRow.id,
      node_path: node.path,
      owner_key: owner.ownerKey,
      owner_login: owner.ownerLogin,
      display_name: owner.displayName,
      normalized_score: owner.normalizedScore,
      raw_score: owner.rawScore,
      rank: owner.rank,
    })),
  );

  if (ownerRows.length) {
    const { error } = await supabase.from("analysis_node_owners").insert(ownerRows);

    if (error) {
      throw new Error(error.message);
    }
  }

  const edgeRows = input.analysis.edges.map((edge) => ({
    snapshot_id: snapshotRow.id,
    source_path: edge.source,
    target_path: edge.target,
    label: edge.data?.label ?? null,
  }));

  if (edgeRows.length) {
    const { error } = await supabase.from("analysis_graph_edges").insert(edgeRows);

    if (error) {
      throw new Error(error.message);
    }
  }

  return snapshotRow;
}

async function runOwnershipAnalysis(run: AnalysisRunRow) {
  const { repository, accessToken } = await getRepositoryAndTokenForRun(run);

  await updateRunProgress({
    runId: run.id,
    progressPhase: "fetching-tree",
    progressPct: 15,
    processedCommitCount: 0,
    selectedCommitCount: 0,
  });

  const repositoryTreePaths = await fetchRepositoryTree({
    accessToken,
    owner: repository.owner_login,
    repo: repository.name,
    defaultBranch: repository.default_branch,
  });

  const filePaths = filterRelevantCodePaths(repositoryTreePaths);
  const analysisModeSelection = selectAnalysisMode();
  const commitWindowStart = analysisModeSelection.commitWindowStart;
  const commitWindowEnd = nowIso();

  await updateRun(run.id, {
    status: "processing",
    progress_phase: "fetching-history",
    progress_pct: 25,
    commit_limit: analysisModeSelection.commitLimit,
    commit_window_start: commitWindowStart,
    commit_window_end: commitWindowEnd,
    selected_commit_count: 0,
    processed_commit_count: 0,
  });

  const commitActivity = await fetchRecentCommitActivity({
    accessToken,
    owner: repository.owner_login,
    repo: repository.name,
    defaultBranch: repository.default_branch,
    commitLimit: analysisModeSelection.commitLimit,
    since: analysisModeSelection.commitWindowStart,
    shouldIncludeFile: isRelevantCodeFile,
    onProgress: async (processedCount, totalCount) => {
      if (!shouldPersistCommitProgress(processedCount, totalCount)) {
        return;
      }

      await updateRunProgress({
        runId: run.id,
        progressPhase: "fetching-history",
        progressPct: calculateProgressFromCommitProcessing(processedCount, totalCount),
        processedCommitCount: processedCount,
        selectedCommitCount: totalCount,
      });
    },
  });

  await updateRunProgress({
    runId: run.id,
    progressPhase: "calculating-ownership",
    progressPct: 85,
    processedCommitCount: commitActivity.activities.length,
    selectedCommitCount: commitActivity.selectedCommitCount,
  });

  const analysis = buildOwnershipAnalysis({
    repositoryLabel: repository.full_name,
    filePaths,
    commits: commitActivity.activities,
    maxDepth: analysisModeSelection.collapseDepth,
  });

  await updateRunProgress({
    runId: run.id,
    progressPhase: "persisting-snapshot",
    progressPct: 92,
    processedCommitCount: commitActivity.activities.length,
    selectedCommitCount: commitActivity.selectedCommitCount,
  });

  const snapshotRow = await persistAnalysisSnapshot({
    run,
    analysisMode: analysisModeSelection.analysisMode,
    degradedReason: null,
    treeFileCount: filePaths.length,
    commitCountProcessed: commitActivity.activities.length,
    analysis,
  });

  await updateRun(run.id, {
    status: "completed",
    progress_phase: "completed",
    progress_pct: 100,
    snapshot_id: snapshotRow.id,
    finished_at: nowIso(),
    processed_commit_count: commitActivity.activities.length,
    selected_commit_count: commitActivity.selectedCommitCount,
    worker_id: null,
    leased_at: null,
    lease_expires_at: null,
    error_message: null,
    last_error_code: null,
    last_error_message: null,
  });
}

async function markRunQueuedForRetry(run: AnalysisRunRow, errorCode: string, errorMessage: string) {
  await updateRun(run.id, {
    status: "queued",
    progress_phase: "retrying",
    error_message: errorMessage,
    last_error_code: errorCode,
    last_error_message: errorMessage,
    worker_id: null,
    leased_at: null,
    lease_expires_at: null,
    finished_at: null,
  });
}

async function markRunFailed(run: AnalysisRunRow, status: Extract<RunStatus, "failed" | "dead_letter">, errorCode: string, errorMessage: string) {
  await updateRun(run.id, {
    status,
    progress_phase: status === "dead_letter" ? "dead-letter" : "failed",
    progress_pct: run.progress_pct,
    error_message: errorMessage,
    last_error_code: errorCode,
    last_error_message: errorMessage,
    finished_at: nowIso(),
    worker_id: null,
    leased_at: null,
    lease_expires_at: null,
  });
}

function startLeaseHeartbeat(messageId: number, lockInput: { repositoryId: string; runId: string; workerId: string }) {
  const intervalMs = Math.max(10_000, Math.floor(getServerEnv().ANALYSIS_LOCK_LEASE_SECONDS * 1000 * 0.5));
  const timer = setInterval(() => {
    void Promise.all([
      extendOwnershipAnalysisJobVisibility(messageId),
      renewRepositoryProcessingLock(lockInput),
    ]).catch((error) => {
      console.error("[worker] unable to renew lease", error);
    });
  }, intervalMs);

  return () => {
    clearInterval(timer);
  };
}

async function leaseAnalysisRun(run: AnalysisRunRow, envelope: QueueEnvelope, workerId: string) {
  const leaseExpiresAt = new Date(Date.now() + getServerEnv().ANALYSIS_LOCK_LEASE_SECONDS * 1000).toISOString();

  return updateRun(run.id, {
    status: "leased",
    progress_phase: "leased",
    progress_pct: Math.max(run.progress_pct, 5),
    attempt_count: envelope.readCount,
    leased_at: nowIso(),
    lease_expires_at: leaseExpiresAt,
    worker_id: workerId,
    last_error_code: null,
    last_error_message: null,
  });
}

async function loadRunForEnvelope(envelope: QueueEnvelope) {
  const run = await getAnalysisRunById(envelope.message.run_id);

  if (!run) {
    await archiveOwnershipAnalysisJob(envelope.msgId);
    return null;
  }

  if (run.status === "completed" || run.status === "failed" || run.status === "dead_letter") {
    await deleteOwnershipAnalysisJob(envelope.msgId);
    return null;
  }

  return run;
}

async function processEnvelope(envelope: QueueEnvelope, workerId: string) {
  const run = await loadRunForEnvelope(envelope);

  if (!run) {
    return true;
  }

  const lockAcquired = await acquireRepositoryProcessingLock({
    repositoryId: run.repository_id,
    runId: run.id,
    workerId,
  });

  if (!lockAcquired) {
    return false;
  }

  const releaseHeartbeat = startLeaseHeartbeat(envelope.msgId, {
    repositoryId: run.repository_id,
    runId: run.id,
    workerId,
  });

  try {
    const leasedRun = await leaseAnalysisRun(run, envelope, workerId);

    await updateRun(leasedRun.id, {
      status: "processing",
      progress_phase: "preparing",
      progress_pct: Math.max(leasedRun.progress_pct, 10),
      started_at: leasedRun.started_at ?? nowIso(),
    });

    await runOwnershipAnalysis(leasedRun);
    await deleteOwnershipAnalysisJob(envelope.msgId);
    return true;
  } catch (error) {
    const descriptor = classifyAnalysisError(error);
    const latestRun = (await getAnalysisRunById(run.id)) ?? run;
    const nextAttemptCount = Math.max(latestRun.attempt_count, envelope.readCount);

    if (!descriptor.retryable) {
      await markRunFailed(latestRun, "failed", descriptor.code, descriptor.message);
      await archiveOwnershipAnalysisJob(envelope.msgId);
      return true;
    }

    if (nextAttemptCount >= latestRun.max_attempts) {
      await markRunFailed(latestRun, "dead_letter", descriptor.code, descriptor.message);
      await archiveOwnershipAnalysisJob(envelope.msgId);
      return true;
    }

    await markRunQueuedForRetry(latestRun, descriptor.code, descriptor.message);
    console.error(`[worker] retrying analysis run ${run.id}`, error);
    return false;
  } finally {
    releaseHeartbeat();
    await releaseRepositoryProcessingLock({
      repositoryId: run.repository_id,
      runId: run.id,
      workerId,
    }).catch((error) => {
      console.error("[worker] unable to release repository lock", error);
    });
  }
}

export async function enqueueAnalysisRunForRepository(input: {
  userId: string;
  repositoryId: string;
}): Promise<AnalysisRunRow> {
  const repository = await getRepositoryForUser(input.userId, input.repositoryId);

  if (!repository) {
    throw new Error("Repository not found.");
  }

  const supabase = createServiceRoleSupabaseClient();
  const commitWindowStart = FULL_HISTORY_WINDOW_START;
  const commitWindowEnd = nowIso();
  const { data, error } = await supabase
    .from("analysis_runs")
    .insert({
      user_id: input.userId,
      repository_id: input.repositoryId,
      status: "queued",
      progress_phase: "queued",
      progress_pct: 0,
      attempt_count: 0,
      max_attempts: DEFAULT_MAX_ATTEMPTS,
      processed_commit_count: 0,
      selected_commit_count: 0,
      commit_window_start: commitWindowStart,
      commit_window_end: commitWindowEnd,
      commit_limit: DEFAULT_COMMIT_LIMIT,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  const run = data as AnalysisRunRow;

  await enqueueOwnershipAnalysisJob({
    run_id: run.id,
    repository_id: run.repository_id,
    user_id: run.user_id,
    attempt: 1,
  });

  return run;
}

export async function getAnalysisRunForUser(input: {
  userId: string;
  repositoryId: string;
  runId: string;
}): Promise<AnalysisRunRow | null> {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase
    .from("analysis_runs")
    .select("*")
    .eq("id", input.runId)
    .eq("repository_id", input.repositoryId)
    .eq("user_id", input.userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as AnalysisRunRow | null) ?? null;
}

export async function processNextQueuedAnalysisJob(workerId: string) {
  const [envelope] = await readOwnershipAnalysisJobs(1);

  if (!envelope) {
    return false;
  }

  return processEnvelope(envelope, workerId);
}
