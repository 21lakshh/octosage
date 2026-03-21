import { NextResponse } from "next/server";

import { getAnalysisRunForUser } from "@/src/services/analysis/service";
import { mapAnalysisRunStatus } from "@/src/services/analysis/status-service";
import { requireCurrentUser } from "@/src/services/auth/service";
import { analysisRunStatusSchema, runParamsSchema } from "@/src/types/schemas";

export async function GET(
  _request: Request,
  context: { params: Promise<{ repositoryId: string; runId: string }> },
) {
  const user = await requireCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = runParamsSchema.parse(await context.params);
  const run = await getAnalysisRunForUser({
    userId: user.id,
    repositoryId: params.repositoryId,
    runId: params.runId,
  });

  if (!run) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(analysisRunStatusSchema.parse(mapAnalysisRunStatus(run)));
}
