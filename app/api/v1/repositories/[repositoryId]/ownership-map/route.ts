import { NextResponse } from "next/server";

import { requireCurrentUser } from "@/src/services/auth/service";
import { getOwnershipMapForUser } from "@/src/services/ownership/service";
import { ownershipMapResponseSchema, repositoryIdParamsSchema } from "@/src/types/schemas";

export async function GET(
  _request: Request,
  context: { params: Promise<{ repositoryId: string }> },
) {
  const user = await requireCurrentUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = repositoryIdParamsSchema.parse(await context.params);
  const ownershipMap = await getOwnershipMapForUser({
    userId: user.id,
    repositoryId: params.repositoryId,
  });

  if (!ownershipMap) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json(ownershipMapResponseSchema.parse(ownershipMap));
}
