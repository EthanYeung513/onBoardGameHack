import { redirect } from "next/navigation";
import { Header } from "@/components/gen/shell/Header";
import { runAllChecks } from "@/lib/status/checks";
import { currentUser } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export default async function StatusPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/status");
  const results = await runAllChecks();
  const failing = results.filter((r) => !r.ok && !r.optional).length;
  return (
    <>
      <Header email={user.email} crumbs={[{ label: "Service status" }]} />
      <main className="mx-auto max-w-5xl space-y-6 px-6 py-10">
        <div>
          <h1 className="text-3xl font-bold">Service status</h1>
          <p className="g-muted">
            One real call per service, made just now. {failing === 0 ? "Everything required is working." : `${failing} required service${failing > 1 ? "s are" : " is"} failing.`}
          </p>
        </div>
        <table className="g-panel w-full overflow-hidden text-left text-sm">
          <thead style={{ background: "var(--g-canvas)" }}>
            <tr>
              <th className="px-4 py-2">Service</th>
              <th className="px-4 py-2">Result</th>
              <th className="px-4 py-2">Time</th>
              <th className="px-4 py-2">Detail</th>
            </tr>
          </thead>
          <tbody>
            {results.map((r) => (
              <tr key={r.name} className="border-t align-top" style={{ borderColor: "var(--g-line)" }} data-testid="status-row">
                <td className="px-4 py-3 font-medium">{r.name}</td>
                <td className="px-4 py-3 font-semibold" style={{ color: r.ok ? "var(--g-ok)" : r.optional ? "var(--g-marigold-deep)" : "var(--g-danger)" }}>
                  {r.ok ? "Pass" : r.optional ? "Warning" : "Fail"}
                </td>
                <td className="g-muted px-4 py-3">{r.ms} ms</td>
                <td className="px-4 py-3 break-words">{r.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </>
  );
}
