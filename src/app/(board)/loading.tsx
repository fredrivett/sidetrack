import { headers } from "next/headers";
import { BoardSkeleton } from "@/components/BoardSkeleton";

// Streams the skeleton at once while page.tsx checks the session and reads the
// board. Scoped to the (board) group so other routes don't get a board skeleton.
// The skeleton is the view in the path, which the proxy passes in a header
// (a loading file gets no searchParams).
export default async function Loading() {
  const view = (await headers()).get("x-board-view");
  return (
    <BoardSkeleton
      view={view === "board" || view === "done" || view === "archived" ? view : "brief"}
    />
  );
}
