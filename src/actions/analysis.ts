"use server";

import { revalidatePath } from "next/cache";

import { enqueueAnalysisRunForRepository } from "@/src/services/analysis/service";
import { requireCurrentUser } from "@/src/services/auth/service";

async function requireUserId() {
  const user = await requireCurrentUser();

  if (!user) {
    throw new Error("You must be signed in to analyze a repository.");
  }

  return user.id;
}

export async function enqueueRepositoryAnalysisAction(input: { repositoryId: string }) {
  const userId = await requireUserId();
  const run = await enqueueAnalysisRunForRepository({
    userId,
    repositoryId: input.repositoryId,
  });

  revalidatePath("/repositories");
  revalidatePath(`/repositories/${input.repositoryId}`);

  return run.id;
}

export async function rerunRepositoryAnalysisAction(repositoryId: string) {
  return enqueueRepositoryAnalysisAction({ repositoryId });
}
