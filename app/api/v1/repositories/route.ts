import { NextResponse } from "next/server";

import { requireCurrentUser } from "@/src/services/auth/service";
import { listRepositorySummariesForUser, syncRepositoriesForUser } from "@/src/services/repositories/service";
import { repositorySummarySchema } from "@/src/types/schemas";

export async function GET(request: Request) {
  const user = await requireCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "9", 10)));

  if (page === 1) {
    await syncRepositoriesForUser(user.id);
  }

  const paginated = await listRepositorySummariesForUser(user.id, page, limit);

  return NextResponse.json({
    ...paginated,
    data: repositorySummarySchema.array().parse(paginated.data)
  });
}
