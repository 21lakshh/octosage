const IGNORED_DIRECTORY_SEGMENTS = new Set([
  ".git",
  ".github",
  ".next",
  ".turbo",
  "assets",
  "build",
  "coverage",
  "dist",
  "docs",
  "fixtures",
  "mocks",
  "node_modules",
  "public",
  "storybook-static",
  "tmp",
  "vendor",
]);

const IGNORED_FILE_BASENAMES = new Set([
  ".dockerignore",
  ".env",
  ".env.example",
  ".gitignore",
  "bun.lockb",
  "package-lock.json",
  "pnpm-lock.yaml",
  "readme.md",
  "yarn.lock",
]);

const CODE_FILE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "cs",
  "css",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "jsx",
  "kt",
  "mjs",
  "php",
  "py",
  "rb",
  "rs",
  "scala",
  "sh",
  "sql",
  "swift",
  "ts",
  "tsx",
]);

function getBasename(path: string) {
  const segments = path.split("/").filter(Boolean);
  return segments.at(-1)?.toLowerCase() ?? path.toLowerCase();
}

function getExtension(path: string) {
  const basename = getBasename(path);
  const extension = basename.split(".").at(-1);

  if (!extension || extension === basename) {
    return "";
  }

  return extension.toLowerCase();
}

export function isRelevantCodeFile(path: string) {
  const normalizedPath = path.trim().replace(/^\/+/, "");

  if (!normalizedPath) {
    return false;
  }

  const segments = normalizedPath.split("/").filter(Boolean);
  const basename = getBasename(normalizedPath);
  const extension = getExtension(normalizedPath);

  if (IGNORED_FILE_BASENAMES.has(basename)) {
    return false;
  }

  if (segments.some((segment) => IGNORED_DIRECTORY_SEGMENTS.has(segment.toLowerCase()))) {
    return false;
  }

  return CODE_FILE_EXTENSIONS.has(extension);
}

export function filterRelevantCodePaths(paths: string[]) {
  return paths.filter((path) => isRelevantCodeFile(path));
}
