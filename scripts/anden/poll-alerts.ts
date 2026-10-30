import { mergeAlerts } from "./alerts";

async function main(): Promise<void> {
  const result = await mergeAlerts();
  console.log(
    `alerts: ${result.total} entries (${result.added} new, ${result.updated} seen again)`
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  console.error(`alerts: feed unavailable (${message})`);
  process.exitCode = 1;
});
