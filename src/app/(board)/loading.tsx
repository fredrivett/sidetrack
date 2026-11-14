import { BoardSkeleton } from "@/components/BoardSkeleton";

// Streams the skeleton at once while page.tsx checks the session and reads the
// board. Scoped to the (board) group so other routes don't get a board skeleton.
export default function Loading() {
  return <BoardSkeleton />;
}
