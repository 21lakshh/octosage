import { NextResponse } from "next/server";

import { requireCurrentUser } from "@/src/services/auth/service";
import { getRepositorySummaryForUser } from "@/src/services/repositories/service";
import { repositoryIdParamsSchema, repositorySummarySchema } from "@/src/types/schemas";

export async function GET(
  _request: Request,
  context: { params: Promise<{ repositoryId: string }> },
) {
  const user = await requireCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = repositoryIdParamsSchema.parse(await context.params);
  const repository = await getRepositorySummaryForUser(user.id, params.repositoryId);

  if (!repository) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(repositorySummarySchema.parse(repository));
}
