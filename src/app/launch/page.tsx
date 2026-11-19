import { BoardSkeleton } from "@/components/BoardSkeleton";

// The installed app's start_url (manifest.ts). public/sw.js serves this static
// page from its cache, so a launch paints the board skeleton without waiting on
// the network, then moves on to the real board. The browser keeps the skeleton
// on screen until the board paints. Waiting a frame before leaving makes sure
// the skeleton paints first. Offline, it waits for the connection to return
// instead of leaving for the browser's offline error page.
export default function Launch() {
  return (
    <>
      <BoardSkeleton />
      <script
        dangerouslySetInnerHTML={{
          __html: `requestAnimationFrame(function () {
  setTimeout(function () {
    function go() { location.replace("/brief"); }
    if (navigator.onLine) go();
    else addEventListener("online", go, { once: true });
  });
});`,
        }}
      />
    </>
  );
}
