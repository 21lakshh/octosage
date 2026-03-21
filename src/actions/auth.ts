"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { signInWithGitHub, signOutCurrentUser } from "@/src/services/auth/service";

export async function signInWithGitHubAction() {
  const url = await signInWithGitHub();
  redirect(url);
}

export async function signOutAction() {
  await signOutCurrentUser();
  revalidatePath("/");
  redirect("/");
}
