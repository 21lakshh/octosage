import type { Database } from "@/src/types/database";
import type { OwnershipMapResponse, OwnershipNode, OwnershipTreeNode } from "@/src/types/domain";

import { mapAnalysisRunStatus } from "@/src/services/analysis/status-service";
import { createServiceRoleSupabaseClient } from "@/src/services/_shared/supabase";
import { getAnalysisRunForUser } from "@/src/services/analysis/service";
import { getRepositorySummaryForUser } from "@/src/services/repositories/service";

type SnapshotRow = Database["public"]["Tables"]["analysis_snapshots"]["Row"];
type NodeRow = Database["public"]["Tables"]["analysis_nodes"]["Row"];
type OwnerRow = Database["public"]["Tables"]["analysis_node_owners"]["Row"];
type EdgeRow = Database["public"]["Tables"]["analysis_graph_edges"]["Row"];

async function getLatestSnapshotForRepository(repositoryId: string) {
  const supabase = createServiceRoleSupabaseClient();
  const { data, error } = await supabase
    .from("analysis_snapshots")
    .select("*")
    .eq("repository_id", repositoryId)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as SnapshotRow | null) ?? null;
}

function buildTree(details: OwnershipNode[]) {
  const branches = new Map<string, OwnershipTreeNode>();
  const roots: OwnershipTreeNode[] = [];

  details.forEach((detail) => {
    branches.set(detail.path, {
      path: detail.path,
      label: detail.label,
      riskLevel: detail.riskLevel,
      nodeType: detail.nodeType,
      leadingOwnerId: detail.leadingOwnerId,
      children: [],
    });
  });

  details.forEach((detail) => {
    const branch = branches.get(detail.path);

    if (!branch) {
      return;
    }

    if (!detail.parentPath) {
      roots.push(branch);
      return;
    }

    const parent = branches.get(detail.parentPath);

    if (parent) {
      parent.children.push(branch);
    }
  });

  return roots;
}

function buildGraphNodes(details: OwnershipNode[]) {
  const childrenByParent = new Map<string | null, OwnershipNode[]>();

  details.forEach((node) => {
    const bucket = childrenByParent.get(node.parentPath) ?? [];
    bucket.push(node);
    childrenByParent.set(node.parentPath, bucket);
  });

  childrenByParent.forEach((children) => {
    children.sort((left, right) => {
      if (left.depth !== right.depth) {
        return left.depth - right.depth;
      }

      return left.path.localeCompare(right.path);
    });
  });

  const positions = new Map<string, { x: number; y: number }>();
  let cursorY = 0;

  const layoutNode = (node: OwnershipNode): number => {
    const children = childrenByParent.get(node.path) ?? [];
    const x = node.depth * 320;

    if (!children.length) {
      const y = cursorY * 136;
      cursorY += 1;
      positions.set(node.path, { x, y });
      return y;
    }

    const childYs = children.map((child) => layoutNode(child));
    const y = childYs.reduce((sum, childY) => sum + childY, 0) / childYs.length;
    positions.set(node.path, { x, y });
    return y;
  };

  const roots = (childrenByParent.get(null) ?? []).sort((left, right) => left.path.localeCompare(right.path));
  roots.forEach((root) => {
    layoutNode(root);
  });

  return details.map((node) => ({
    id: node.path,
    type: "ownershipNode",
    position: positions.get(node.path) ?? {
      x: node.depth * 320,
      y: 0,
    },
    data: {
      label: node.label,
      path: node.path,
      riskLevel: node.riskLevel,
      leadingOwnerId: node.leadingOwnerId,
      leadingOwnerShare: node.leadingOwnerShare,
      busFactor: node.busFactor,
      nodeType: node.nodeType,
    },
  }));
}

function mapNodeDetails(nodes: NodeRow[], owners: OwnerRow[]) {
  const ownersByPath = owners.reduce((map: Map<string, OwnerRow[]>, owner: OwnerRow) => {
    const bucket = map.get(owner.node_path) ?? [];
    bucket.push(owner);
    map.set(owner.node_path, bucket);
    return map;
  }, new Map<string, OwnerRow[]>());

  return nodes
    .sort((left, right) => left.path.localeCompare(right.path))
    .map<OwnershipNode>((node) => ({
      path: node.path,
      label: node.label,
      nodeType: node.node_type,
      depth: node.depth,
      parentPath: node.parent_path,
      leadingOwnerId: node.leading_owner_id,
      leadingOwnerShare: node.leading_owner_share,
      busFactor: node.bus_factor,
      riskLevel: node.risk_level,
      rawScoreTotal: node.raw_score_total,
      fileCount: node.file_count,
      ownerCount: node.owner_count,
      owners: (ownersByPath.get(node.path) ?? [])
        .sort((left, right) => left.rank - right.rank)
        .map((owner) => ({
          ownerKey: owner.owner_key,
          ownerLogin: owner.owner_login,
          displayName: owner.display_name,
          normalizedScore: owner.normalized_score,
          rawScore: owner.raw_score,
          rank: owner.rank,
        })),
    }));
}

async function getSnapshotData(snapshot: SnapshotRow) {
  const supabase = createServiceRoleSupabaseClient();
  const [{ data: nodes, error: nodeError }, { data: owners, error: ownerError }, { data: edges, error: edgeError }] =
    await Promise.all([
      supabase.from("analysis_nodes").select("*").eq("snapshot_id", snapshot.id),
      supabase.from("analysis_node_owners").select("*").eq("snapshot_id", snapshot.id),
      supabase.from("analysis_graph_edges").select("*").eq("snapshot_id", snapshot.id),
    ]);

  if (nodeError) {
    throw new Error(nodeError.message);
  }

  if (ownerError) {
    throw new Error(ownerError.message);
  }

  if (edgeError) {
    throw new Error(edgeError.message);
  }

  return {
    nodes: (nodes ?? []) as NodeRow[],
    owners: (owners ?? []) as OwnerRow[],
    edges: (edges ?? []) as EdgeRow[],
  };
}

function mapEdges(edges: EdgeRow[]) {
  return edges.map((edge) => ({
    id: `${edge.source_path}->${edge.target_path}`,
    source: edge.source_path,
    target: edge.target_path,
    type: "smoothstep",
    data: {
      label: edge.label,
    },
  }));
}

export async function getOwnershipMapForUser(input: {
  userId: string;
  repositoryId: string;
}): Promise<OwnershipMapResponse | null> {
  const repository = await getRepositorySummaryForUser(input.userId, input.repositoryId);

  if (!repository) {
    return null;
  }

  const [snapshot, latestRun] = await Promise.all([
    getLatestSnapshotForRepository(input.repositoryId),
    repository.latestRun
      ? getAnalysisRunForUser({
          userId: input.userId,
          repositoryId: input.repositoryId,
          runId: repository.latestRun.id,
        })
      : Promise.resolve(null),
  ]);

  if (!snapshot) {
    return {
      repository,
      latestSnapshotId: null,
      lastAnalyzedAt: null,
      stale: true,
      summary: {
        highRiskModules: 0,
        healthyModules: 0,
        leadingOwnerCoverage: 0,
        activeRun: mapAnalysisRunStatus(latestRun),
      },
      filters: {
        riskLevels: ["critical", "warning", "healthy"],
      },
      analysisMode: null,
      degradedReason: null,
      treeFileCount: 0,
      commitCountProcessed: 0,
      tree: [],
      nodes: [],
      edges: [],
      details: [],
    };
  }

  const { nodes, owners, edges } = await getSnapshotData(snapshot);
  const details = mapNodeDetails(nodes, owners);

  return {
    repository,
    latestSnapshotId: snapshot.id,
    lastAnalyzedAt: snapshot.generated_at,
    stale: repository.stale,
    summary: {
      highRiskModules: snapshot.high_risk_modules,
      healthyModules: snapshot.healthy_modules,
      leadingOwnerCoverage: snapshot.leading_owner_coverage,
      activeRun: latestRun && latestRun.status !== "completed" ? mapAnalysisRunStatus(latestRun) : null,
    },
    filters: {
      riskLevels: ["critical", "warning", "healthy"],
    },
    analysisMode: snapshot.analysis_mode,
    degradedReason: snapshot.degraded_reason,
    treeFileCount: snapshot.tree_file_count,
    commitCountProcessed: snapshot.commit_count_processed,
    tree: buildTree(details),
    nodes: buildGraphNodes(details),
    edges: mapEdges(edges),
    details,
  };
}
