import { LABELS_PATH, readJsonl } from "./corpus";
import { search } from "../../src/lib/anden/retrieval/bm25";

interface Label {
  query: string;
  expected_ids: string[];
}

const K = 5;
const MIN_RECALL = 0.75;

async function main(): Promise<void> {
  const labels = await readJsonl<Label>(LABELS_PATH);

  if (labels.length < 20) {
    console.error(`labels: need at least 20, found ${labels.length}`);
    process.exitCode = 1;
    return;
  }

  let recallSum = 0;
  let reciprocalRankSum = 0;

  for (const label of labels) {
    const results = await search(label.query, K);
    const ids = results.map((result) => result.id);
    const hits = label.expected_ids.filter((id) => ids.includes(id)).length;
    const recall = label.expected_ids.length ? hits / label.expected_ids.length : 0;
    const rank = ids.findIndex((id) => label.expected_ids.includes(id)) + 1;
    const reciprocalRank = rank > 0 ? 1 / rank : 0;

    recallSum += recall;
    reciprocalRankSum += reciprocalRank;

    const mark = recall === 1 ? "ok" : recall > 0 ? "partial" : "miss";
    console.log(`[${mark}] recall=${recall.toFixed(2)} rank=${rank || "-"} ${label.query}`);
    if (recall < 1) console.log(`        expected: ${label.expected_ids.join(", ")}`);
    if (recall < 1) console.log(`        got: ${ids.join(", ")}`);
  }

  const recall = recallSum / labels.length;
  const mrr = reciprocalRankSum / labels.length;

  console.log("");
  console.log(`queries: ${labels.length}`);
  console.log(`recall@${K}: ${recall.toFixed(3)} (threshold ${MIN_RECALL.toFixed(2)})`);
  console.log(`MRR: ${mrr.toFixed(3)}`);

  if (recall < MIN_RECALL) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
