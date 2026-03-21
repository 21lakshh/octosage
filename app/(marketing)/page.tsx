import { SmoothScroll } from "@/src/components/smooth-scroll";
import { Hero } from "@/src/components/hero";
import { BentoGrid } from "@/src/components/bento-grid";
import { FinalCTA } from "@/src/components/final-cta";
import { CustomCursor } from "@/src/components/custom-cursor";
import { getCurrentUser } from "@/src/services/auth/service";

export default async function Home() {
  const user = await getCurrentUser();
  const isLoggedIn = !!user;
  return (
    <SmoothScroll>
      <CustomCursor />
      <main className="flex-1 bg-background text-foreground">
        <Hero isLoggedIn={isLoggedIn} />
        <BentoGrid />
        <FinalCTA isLoggedIn={isLoggedIn} />
      </main>
    </SmoothScroll>
  );
}
