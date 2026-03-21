import { differenceInDays } from "date-fns";

import type { GitHubCommitActivity } from "@/src/integrations/github/types";
import type {
  OwnershipGraphEdge,
  OwnershipGraphNode,
  OwnershipNode,
  OwnershipOwnerShare,
  OwnershipTreeNode,
  RiskLevel,
} from "@/src/types/domain";

const RECENCY_DECAY_DAYS = 45;
const BUS_FACTOR_THRESHOLD = 0.7;

export interface OwnershipAnalysisInput {
  repositoryLabel: string;
  filePaths: string[];
  commits: GitHubCommitActivity[];
  now?: Date;
  maxDepth?: number | null;
}

export interface OwnershipAnalysisResult {
  summary: {
    highRiskModules: number;
    healthyModules: number;
    leadingOwnerCoverage: number;
  };
  details: OwnershipNode[];
  tree: OwnershipTreeNode[];
  nodes: OwnershipGraphNode[];
  edges: OwnershipGraphEdge[];
}

type AggregateNode = {
  path: string;
  label: string;
  nodeType: "file" | "folder";
  depth: number;
  parentPath: string | null;
  ownerScores: Map<string, { ownerLogin: string | null; displayName: string; rawScore: number }>;
  fileCount: number;
};

export function computeContributionScore(changedLines: number, ageInDays: number) {
  return changedLines * Math.exp(-ageInDays / RECENCY_DECAY_DAYS);
}

function toAnalysisPath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

function getLabelFromPath(path: string, repositoryLabel: string) {
  if (path === "/") {
    return repositoryLabel;
  }

  const parts = path.split("/").filter(Boolean);
  return parts.at(-1) ?? repositoryLabel;
}

function getParentPath(path: string) {
  if (path === "/") {
    return null;
  }

  const parts = path.split("/").filter(Boolean);

  if (parts.length <= 1) {
    return "/";
  }

  return `/${parts.slice(0, -1).join("/")}`;
}

function collapsePath(path: string, maxDepth: number | null | undefined) {
  if (!maxDepth || maxDepth < 1) {
    return path;
  }

  const segments = path.split("/").filter(Boolean);

  if (segments.length <= maxDepth) {
    return path;
  }

  return `/${segments.slice(0, maxDepth).join("/")}`;
}

function resolveLeafNodeType(path: string, maxDepth: number | null | undefined): "file" | "folder" {
  if (!maxDepth || maxDepth < 1) {
    return "file";
  }

  const segments = path.split("/").filter(Boolean);
  return segments.length > maxDepth ? "folder" : "file";
}

function getAncestors(path: string) {
  const normalized = toAnalysisPath(path);
  const segments = normalized.split("/").filter(Boolean);
  const ancestors = ["/"];

  if (!segments.length) {
    return ancestors;
  }

  for (let index = 0; index < segments.length - 1; index += 1) {
    ancestors.push(`/${segments.slice(0, index + 1).join("/")}`);
  }

  return ancestors;
}

function createAggregateNode(path: string, repositoryLabel: string, nodeType: "file" | "folder"): AggregateNode {
  return {
    path,
    label: getLabelFromPath(path, repositoryLabel),
    nodeType,
    depth: path === "/" ? 0 : path.split("/").filter(Boolean).length,
    parentPath: getParentPath(path),
    ownerScores: new Map(),
    fileCount: nodeType === "file" ? 1 : 0,
  };
}

function upsertOwnerScore(
  map: AggregateNode["ownerScores"],
  input: { ownerKey: string; ownerLogin: string | null; displayName: string; rawScore: number },
) {
  const existing = map.get(input.ownerKey);

  if (existing) {
    existing.rawScore += input.rawScore;
    return;
  }

  map.set(input.ownerKey, {
    ownerLogin: input.ownerLogin,
    displayName: input.displayName,
    rawScore: input.rawScore,
  });
}

function calculateOwnerShares(map: AggregateNode["ownerScores"]): OwnershipOwnerShare[] {
  const total = Array.from(map.values()).reduce((sum, owner) => sum + owner.rawScore, 0);

  return Array.from(map.entries())
    .map(([ownerKey, owner]) => ({
      ownerKey,
      ownerLogin: owner.ownerLogin,
      displayName: owner.displayName,
      rawScore: owner.rawScore,
      normalizedScore: total > 0 ? owner.rawScore / total : 0,
      rank: 0,
    }))
    .sort((left, right) => right.rawScore - left.rawScore)
    .map((owner, index) => ({ ...owner, rank: index + 1 }));
}

export function calculateBusFactor(owners: OwnershipOwnerShare[]) {
  let runningTotal = 0;

  for (const [index, owner] of owners.entries()) {
    runningTotal += owner.normalizedScore;

    if (runningTotal >= BUS_FACTOR_THRESHOLD) {
      return Math.max(index + 1, 1);
    }
  }

  return Math.max(owners.length, 1);
}

function toRiskLevel(busFactor: number): RiskLevel {
  if (busFactor <= 1) {
    return "critical";
  }

  if (busFactor === 2) {
    return "warning";
  }

  return "healthy";
}

function layoutNodes(details: OwnershipNode[]): OwnershipGraphNode[] {
  const lanes = new Map<number, number>();

  return details.map((node) => {
    const lane = lanes.get(node.depth) ?? 0;
    lanes.set(node.depth, lane + 1);

    return {
      id: node.path,
      position: {
        x: node.depth * 280,
        y: lane * 116,
      },
      type: "ownershipNode",
      data: {
        label: node.label,
        path: node.path,
        riskLevel: node.riskLevel,
        leadingOwnerId: node.leadingOwnerId,
        leadingOwnerShare: node.leadingOwnerShare,
        busFactor: node.busFactor,
        nodeType: node.nodeType,
      },
    };
  });
}

function buildEdges(details: OwnershipNode[]): OwnershipGraphEdge[] {
  return details
    .filter((node) => node.parentPath)
    .map((node) => ({
      id: `${node.parentPath}->${node.path}`,
      source: node.parentPath as string,
      target: node.path,
      type: "smoothstep",
      data: {
        label: null,
      },
    }));
}

function buildTree(details: OwnershipNode[]) {
  const branchMap = new Map<string, OwnershipTreeNode>();

  details.forEach((node) => {
    branchMap.set(node.path, {
      path: node.path,
      label: node.label,
      riskLevel: node.riskLevel,
      nodeType: node.nodeType,
      leadingOwnerId: node.leadingOwnerId,
      children: [],
    });
  });

  const roots: OwnershipTreeNode[] = [];

  details.forEach((node) => {
    const branch = branchMap.get(node.path);

    if (!branch) {
      return;
    }

    if (!node.parentPath) {
      roots.push(branch);
      return;
    }

    const parent = branchMap.get(node.parentPath);

    if (parent) {
      parent.children.push(branch);
    }
  });

  return roots;
}

export function buildOwnershipAnalysis(input: OwnershipAnalysisInput): OwnershipAnalysisResult {
  const now = input.now ?? new Date();
  const currentFiles = new Set(input.filePaths.map((path) => toAnalysisPath(path)));
  const aggregates = new Map<string, AggregateNode>();

  aggregates.set("/", createAggregateNode("/", input.repositoryLabel, "folder"));

  for (const currentFile of currentFiles) {
    const analysisPath = collapsePath(currentFile, input.maxDepth);
    const leafNodeType = resolveLeafNodeType(currentFile, input.maxDepth);

    if (!aggregates.has(analysisPath)) {
      aggregates.set(analysisPath, createAggregateNode(analysisPath, input.repositoryLabel, leafNodeType));
    }

    for (const ancestor of getAncestors(analysisPath)) {
      if (!aggregates.has(ancestor)) {
        aggregates.set(ancestor, createAggregateNode(ancestor, input.repositoryLabel, "folder"));
      }

      const ancestorNode = aggregates.get(ancestor);

      if (ancestorNode) {
        ancestorNode.fileCount += 1;
      }
    }

    if (leafNodeType === "folder") {
      const leafNode = aggregates.get(analysisPath);

      if (leafNode) {
        leafNode.fileCount += 1;
      }
    }
  }

  for (const commit of input.commits) {
    const ageInDays = Math.max(differenceInDays(now, new Date(commit.committedAt)), 0);

    for (const file of commit.files) {
      const path = toAnalysisPath(file.filename);

      if (!currentFiles.has(path)) {
        continue;
      }

      const analysisPath = collapsePath(path, input.maxDepth);

      const changedLines = file.additions + file.deletions;

      if (changedLines <= 0) {
        continue;
      }

      const contributionScore = computeContributionScore(changedLines, ageInDays);
      const scoreEntry = {
        ownerKey: commit.author.ownerKey,
        ownerLogin: commit.author.ownerLogin,
        displayName: commit.author.displayName,
        rawScore: contributionScore,
      };

      const fileNode = aggregates.get(analysisPath);

      if (fileNode) {
        upsertOwnerScore(fileNode.ownerScores, scoreEntry);
      }

      for (const ancestor of getAncestors(analysisPath)) {
        const ancestorNode = aggregates.get(ancestor);

        if (!ancestorNode) {
          continue;
        }

        upsertOwnerScore(ancestorNode.ownerScores, scoreEntry);
      }
    }
  }

  const details = Array.from(aggregates.values())
    .sort((left, right) => left.path.localeCompare(right.path))
    .map<OwnershipNode>((node) => {
      const owners = calculateOwnerShares(node.ownerScores);
      const leadingOwner = owners[0] ?? null;
      const busFactor = calculateBusFactor(owners);
      const rawScoreTotal = owners.reduce((sum, owner) => sum + owner.rawScore, 0);

      return {
        path: node.path,
        label: node.label,
        nodeType: node.nodeType,
        depth: node.depth,
        parentPath: node.parentPath,
        leadingOwnerId: leadingOwner?.ownerKey ?? null,
        leadingOwnerShare: leadingOwner?.normalizedScore ?? 0,
        busFactor,
        riskLevel: toRiskLevel(busFactor),
        rawScoreTotal,
        fileCount: node.nodeType === "file" ? 1 : node.fileCount,
        ownerCount: owners.length,
        owners,
      };
    });

  const summary = details.reduce(
    (accumulator, node) => {
      if (node.riskLevel === "critical") {
        accumulator.highRiskModules += 1;
      }

      if (node.riskLevel === "healthy") {
        accumulator.healthyModules += 1;
      }

      accumulator.leadingOwnerCoverage += node.leadingOwnerShare;

      return accumulator;
    },
    {
      highRiskModules: 0,
      healthyModules: 0,
      leadingOwnerCoverage: 0,
    },
  );

  summary.leadingOwnerCoverage = details.length
    ? summary.leadingOwnerCoverage / details.length
    : 0;

  return {
    summary,
    details,
    tree: buildTree(details),
    nodes: layoutNodes(details),
    edges: buildEdges(details),
  };
}
