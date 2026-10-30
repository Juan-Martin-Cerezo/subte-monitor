import { mergeAlerts } from './alerts';
import {
  ALERTS_PATH,
  DOCS_PATH,
  KNOWLEDGE_PATH,
  buildDocChunks,
  readJsonl,
  writeJsonl,
  type CorpusEntry,
} from './corpus';

async function main(): Promise<void> {
  const docs = await buildDocChunks();
  await writeJsonl(DOCS_PATH, docs);
  console.log(`docs: ${docs.length} chunks`);

  try {
    const result = await mergeAlerts();
    console.log(`alerts: ${result.total} entries (${result.added} new, ${result.updated} seen again)`);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error';
    console.warn(`alerts: feed unavailable, kept existing file (${message})`);
  }

  const knowledge = await readJsonl<CorpusEntry>(KNOWLEDGE_PATH);
  const alerts = await readJsonl<CorpusEntry>(ALERTS_PATH);
  console.log(`knowledge: ${knowledge.length} entries`);
  console.log(`alerts: ${alerts.length} entries`);
  console.log(`docs: ${(await readJsonl<CorpusEntry>(DOCS_PATH)).length} chunks`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
