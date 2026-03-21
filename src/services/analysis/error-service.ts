export type AnalysisErrorCode =
  | "github_rate_limit"
  | "github_auth"
  | "github_permissions"
  | "github_network"
  | "repository_too_large"
  | "persistence_error"
  | "queue_error"
  | "unknown";

export interface AnalysisErrorDescriptor {
  code: AnalysisErrorCode;
  message: string;
  retryable: boolean;
}

function getErrorStatus(error: unknown) {
  if (typeof error === "object" && error !== null && "status" in error && typeof error.status === "number") {
    return error.status;
  }

  return null;
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error && typeof error.message === "string") {
    return error.message;
  }

  return "Unknown analysis error.";
}

export function classifyAnalysisError(error: unknown): AnalysisErrorDescriptor {
  const status = getErrorStatus(error);
  const message = getErrorMessage(error);
  const normalizedMessage = message.toLowerCase();

  if (normalizedMessage.includes("too large")) {
    return { code: "repository_too_large", message, retryable: false };
  }

  if (status === 401) {
    return { code: "github_auth", message, retryable: false };
  }

  if (status === 403 || status === 404) {
    const rateLimit = normalizedMessage.includes("rate limit") || normalizedMessage.includes("secondary rate");

    if (rateLimit) {
      return { code: "github_rate_limit", message, retryable: true };
    }

    return { code: "github_permissions", message, retryable: false };
  }

  if (status === 408 || status === 409 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return { code: "github_network", message, retryable: true };
  }

  if (normalizedMessage.includes("network") || normalizedMessage.includes("timed out") || normalizedMessage.includes("econnreset")) {
    return { code: "github_network", message, retryable: true };
  }

  if (normalizedMessage.includes("queue")) {
    return { code: "queue_error", message, retryable: true };
  }

  if (normalizedMessage.includes("insert") || normalizedMessage.includes("update") || normalizedMessage.includes("supabase")) {
    return { code: "persistence_error", message, retryable: true };
  }

  return { code: "unknown", message, retryable: true };
}
