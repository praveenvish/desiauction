import { notFound } from "next/navigation";

import { posterPicker } from "../../../../server/competition/posters";
import { PosterStudio } from "./poster-studio";
import "../../seasons.css";

export const metadata = { title: "Posters · DesiAuction" };

/**
 * THE POSTER STUDIO.
 *
 * The hour after the gavel falls is the only hour when every owner and every
 * player WANTS to broadcast, and until this screen existed the product had
 * nothing for them to broadcast WITH: the image routes were reachable only by
 * typing a URL. This is the door.
 *
 * A refusal from `posterPicker` is a 404 rather than a rendered error. The gate
 * already decided that whether this season exists is not a fact an outsider
 * gets to confirm, and a page that said "you can't generate posters here" would
 * confirm it.
 */
export default async function PostersPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const view = await posterPicker(slug);
  if ("ok" in view) {
    notFound();
  }
  return (
    <main className="registrations-dash">
      <div className="dash-stack">
        <PosterStudio slug={slug} view={view} />
      </div>
    </main>
  );
}
