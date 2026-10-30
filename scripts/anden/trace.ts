import { HARNESS_CONFIG } from '../../src/lib/anden/harness/config';
import { getStore } from '../../src/lib/anden/store';

function clip(value: string): string {
  return value.length > HARNESS_CONFIG.maxDetailChars
    ? `${value.slice(0, HARNESS_CONFIG.maxDetailChars)}... (truncado)`
    : value;
}

async function main(): Promise<void> {
  const traceId = process.argv[2]?.trim();

  if (!traceId) {
    console.error('uso: npm run anden:trace -- <trace_id>');
    process.exitCode = 2;
    return;
  }

  const store = getStore();
  await store.init();
  const trace = await store.getTrace(traceId);

  if (!trace) {
    console.error(`no encontré la traza ${traceId}`);
    process.exitCode = 1;
    return;
  }

  console.log(trace.question);
  console.log(
    `${trace.createdAt} · ${trace.totalMs}ms · ${trace.tokens} tokens · $${trace.costUsd.toFixed(6)} · ` +
      `${trace.ok ? 'ok' : 'con error'}${trace.truncated ? ' · truncada' : ''}`,
  );
  console.log(`modelo: ${trace.model}`);
  console.log(`prompt: sha256:${trace.promptHash}`);
  console.log(`params: ${trace.params}`);

  for (const step of trace.steps) {
    console.log('');
    console.log(
      `#${step.step} ${step.kind} ${step.ok ? 'ok' : 'falló'} ${step.ms}ms ` +
        `tokens ${step.tokensIn}/${step.tokensOut}`,
    );
    console.log(`  in : ${clip(step.input)}`);
    console.log(`  out: ${clip(step.output)}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
