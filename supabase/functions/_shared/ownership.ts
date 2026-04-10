export interface NormalizedAuthor {
  ownerKey: string;
  ownerLogin: string | null;
  displayName: string;
}

export interface GitHubCommitFileStat {
  filename: string;
  additions: number;
  deletions: number;
  status: string;
}

export interface GitHubCommitActivity {
  sha: string;
  committedAt: string;
  author: NormalizedAuthor;
  files: GitHubCommitFileStat[];
}

export interface OwnershipOwnerShare {
  ownerKey: string;
  ownerLogin: string | null;
  displayName: string;
  normalizedScore: number;
  rawScore: number;
  rank: number;
}

export interface OwnershipNode {
  path: string;
  label: string;
  nodeType: "file" | "folder";
  depth: number;
  parentPath: string | null;
  leadingOwnerId: string | null;
  leadingOwnerShare: number;
  busFactor: number;
  riskLevel: "critical" | "warning" | "healthy";
  rawScoreTotal: number;
  fileCount: number;
  ownerCount: number;
  owners: OwnershipOwnerShare[];
}

export interface OwnershipAnalysisResult {
  summary: {
    highRiskModules: number;
    healthyModules: number;
    leadingOwnerCoverage: number;
  };
  details: OwnershipNode[];
  edges: Array<{
    source: string;
    target: string;
    data?: { label?: string | null };
  }>;
}

interface OwnershipAnalysisInput {
  repositoryLabel: string;
  filePaths: string[];
  commits: GitHubCommitActivity[];
}

const RECENCY_DECAY_DAYS = 45;
const BUS_FACTOR_THRESHOLD = 0.7;
const ADDITION_WEIGHT = 1;
const DELETION_WEIGHT = 0.6;
const MAX_SURVIVAL_EROSION = 0.35;
const SURVIVAL_EROSION_SCALE = 500;

type AggregateNode = {
  path: string;
  label: string;
  nodeType: "file" | "folder";
  depth: number;
  parentPath: string | null;
  ownerScores: Map<string, { ownerLogin: string | null; displayName: string; rawScore: number }>;
  fileCount: number;
};

function differenceInDays(now: Date, then: Date) {
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));
}

function toAnalysisPath(path: string) {
  return path.startsWith("/") ? path : `/${path}`;
}

function getLabelFromPath(path: string, repositoryLabel: string) {
  if (path === "/") {
    return repositoryLabel;
  }

  return path.split("/").filter(Boolean).at(-1) ?? repositoryLabel;
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

function getAncestors(path: string) {
  const normalized = toAnalysisPath(path);
  const segments = normalized.split("/").filter(Boolean);
  const ancestors = ["/"];

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

function calculateBusFactor(owners: OwnershipOwnerShare[]) {
  let runningTotal = 0;

  for (const [index, owner] of owners.entries()) {
    runningTotal += owner.normalizedScore;
    if (runningTotal >= BUS_FACTOR_THRESHOLD) {
      return Math.max(index + 1, 1);
    }
  }

  return Math.max(owners.length, 1);
}

function toRiskLevel(busFactor: number): "critical" | "warning" | "healthy" {
  if (busFactor <= 1) {
    return "critical";
  }

  if (busFactor === 2) {
    return "warning";
  }

  return "healthy";
}

function computeWeightedChangeLines(additions: number, deletions: number) {
  return additions * ADDITION_WEIGHT + deletions * DELETION_WEIGHT;
}

function computeContributionScore(changedLines: number, ageInDays: number) {
  return Math.log1p(changedLines) * Math.exp(-ageInDays / RECENCY_DECAY_DAYS);
}

function computeSurvivalErosion(weightedLines: number) {
  return Math.min(MAX_SURVIVAL_EROSION, weightedLines / SURVIVAL_EROSION_SCALE);
}

export function buildOwnershipAnalysis(input: OwnershipAnalysisInput): OwnershipAnalysisResult {
  const now = new Date();
  const currentFiles = new Set(input.filePaths.map((path) => toAnalysisPath(path)));
  const aggregates = new Map<string, AggregateNode>();
  const leafOwnerScores = new Map<string, AggregateNode["ownerScores"]>();

  aggregates.set("/", createAggregateNode("/", input.repositoryLabel, "folder"));

  for (const currentFile of currentFiles) {
    if (!aggregates.has(currentFile)) {
      aggregates.set(currentFile, createAggregateNode(currentFile, input.repositoryLabel, "file"));
    }

    if (!leafOwnerScores.has(currentFile)) {
      leafOwnerScores.set(currentFile, new Map());
    }

    for (const ancestor of getAncestors(currentFile)) {
      if (!aggregates.has(ancestor)) {
        aggregates.set(ancestor, createAggregateNode(ancestor, input.repositoryLabel, "folder"));
      }

      const ancestorNode = aggregates.get(ancestor);
      if (ancestorNode) {
        ancestorNode.fileCount += 1;
      }
    }
  }

  const commits = [...input.commits].sort(
    (left, right) => new Date(left.committedAt).getTime() - new Date(right.committedAt).getTime(),
  );

  for (const commit of commits) {
    const ageInDays = differenceInDays(now, new Date(commit.committedAt));

    for (const file of commit.files) {
      const path = toAnalysisPath(file.filename);
      if (!currentFiles.has(path)) {
        continue;
      }

      const weightedLines = computeWeightedChangeLines(file.additions, file.deletions);
      if (weightedLines <= 0) {
        continue;
      }

      const contributionScore = computeContributionScore(weightedLines, ageInDays);
      const erosion = computeSurvivalErosion(weightedLines);
      const fileOwnerScores = leafOwnerScores.get(path);

      if (!fileOwnerScores) {
        continue;
      }

      for (const [ownerKey, ownerScore] of fileOwnerScores.entries()) {
        if (ownerKey === commit.author.ownerKey) {
          continue;
        }

        ownerScore.rawScore *= 1 - erosion;
      }

      upsertOwnerScore(fileOwnerScores, {
        ownerKey: commit.author.ownerKey,
        ownerLogin: commit.author.ownerLogin,
        displayName: commit.author.displayName,
        rawScore: contributionScore,
      });
    }
  }

  for (const [analysisPath, ownerScores] of leafOwnerScores.entries()) {
    const fileNode = aggregates.get(analysisPath);
    if (fileNode) {
      for (const [ownerKey, ownerScore] of ownerScores.entries()) {
        upsertOwnerScore(fileNode.ownerScores, {
          ownerKey,
          ownerLogin: ownerScore.ownerLogin,
          displayName: ownerScore.displayName,
          rawScore: ownerScore.rawScore,
        });
      }
    }

    for (const ancestor of getAncestors(analysisPath)) {
      const ancestorNode = aggregates.get(ancestor);
      if (!ancestorNode) {
        continue;
      }

      for (const [ownerKey, ownerScore] of ownerScores.entries()) {
        upsertOwnerScore(ancestorNode.ownerScores, {
          ownerKey,
          ownerLogin: ownerScore.ownerLogin,
          displayName: ownerScore.displayName,
          rawScore: ownerScore.rawScore,
        });
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

  summary.leadingOwnerCoverage = details.length ? summary.leadingOwnerCoverage / details.length : 0;

  return {
    summary,
    details,
    edges: details
      .filter((node) => node.parentPath)
      .map((node) => ({
        source: node.parentPath as string,
        target: node.path,
        data: { label: null },
      })),
  };
}
