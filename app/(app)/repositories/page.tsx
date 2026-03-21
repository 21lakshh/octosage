import { RepositoryListClient } from "@/src/components/repositories/repository-list-client";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default function RepositoriesPage() {
  return (
    <main className="space-y-6 pt-24 pb-32 px-4 bg-[#050505] min-h-screen">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-white/10 bg-white/5 text-zinc-400 hover:text-white hover:bg-white/10 text-[10px] font-mono uppercase tracking-widest transition-all hover:border-white/20 hover:-translate-x-1"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Home
          </Link>
        </div>
        <section className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-3xl px-8 py-10 relative z-20">
          <p className="font-mono text-xs uppercase tracking-[0.22em] text-zinc-400 mb-2">Repository selection</p>
          <h1 className="text-3xl sm:text-4xl font-light tracking-tight text-white mb-4">
            Compute the <span className="italic font-serif text-white/80">ownership graph.</span>
          </h1>
          <p className="max-w-3xl text-sm leading-relaxed text-zinc-400 font-mono">
            Synced from GitHub through Octokit, then cached in Supabase by user and
            repository. Kick off analysis on demand and keep the latest successful snapshot ready for
            the next visit.
          </p>
        </section>

        <div className="mt-8">
          <RepositoryListClient />
        </div>
      </div>
    </main>
  );
}
