import { NextResponse } from "next/server";

import { requireCurrentUser } from "@/src/services/auth/service";
import { listRepositorySummariesForUser } from "@/src/services/repositories/service";
import { repositorySummarySchema } from "@/src/types/schemas";

export async function GET(request: Request) {
  const user = await requireCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1", 10);
  const limit = parseInt(searchParams.get("limit") || "10", 10);

  const paginated = await listRepositorySummariesForUser(user.id, page, limit);

  return NextResponse.json({
    ...paginated,
    data: repositorySummarySchema.array().parse(paginated.data)
  });
}
