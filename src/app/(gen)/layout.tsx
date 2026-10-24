import { Bricolage_Grotesque, Instrument_Sans } from "next/font/google";
import "./gen.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-gen-display", weight: ["500", "700"] });
const body = Instrument_Sans({ subsets: ["latin"], variable: "--font-gen-body" });

export const metadata = { title: "Onboarding Studio", description: "Turn a company website into branded, gamified onboarding flows." };

export default function GenLayout({ children }: { children: React.ReactNode }) {
  return <div className={`gen ${display.variable} ${body.variable}`}>{children}</div>;
}
