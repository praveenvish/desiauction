import { notFound } from "next/navigation";
import { todayForPerson } from "../../../../../server/scoring/today";
import { TodayBoard } from "./today-board";
import "../../../seasons.css";
import "../../_tabs/tabs.css";
import "./today.css";
export const metadata = { title: "Match day" };
export default async function TodayPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await todayForPerson(slug);
  if (!view) notFound();
  return (
    <main className="registrations-dash">
      <TodayBoard view={view} />
    </main>
  );
}
