// npm run verify-videos → re-checks every stored video ID, swaps out dead / private / non-embeddable ones.
import { verifyAllVideos } from "../lib/pipeline";

verifyAllVideos().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
