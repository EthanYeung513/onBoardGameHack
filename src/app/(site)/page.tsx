import { Footer } from "@/components/site/Footer";
import { Hero } from "@/components/site/Hero";
import { Nav } from "@/components/site/Nav";
import { Cta, Features, HowItWorks, Motion, Why } from "@/components/site/Sections";

/** Marketing landing page (PRD F1): server-rendered, no client JS beyond Next's own. */
export default function LandingPage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Motion />
        <Why />
        <HowItWorks />
        <Features />
        <Cta />
      </main>
      <Footer />
    </>
  );
}
