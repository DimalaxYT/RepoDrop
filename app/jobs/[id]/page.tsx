import { notFound, redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { ensureWorkerInit, jobOwnedBy } from "@/lib/jobs";
import { JobView } from "@/components/JobView";

export const metadata = { title: "Suivi de l'import" };

export default async function JobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  ensureWorkerInit();
  const { id } = await params;
  const job = jobOwnedBy(id, session.login);
  if (!job) notFound();

  return (
    <main>
      <JobView initialJob={job} />
    </main>
  );
}
