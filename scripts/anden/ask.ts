import { loadEnv } from "./env";
import { runHarness } from "../../src/lib/anden/harness";
import { LlmConfigError } from "../../src/lib/anden/llm";

const MAX_QUESTION = 500;

function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (!entries.length) return "";
  return entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(", ");
}

async function main(): Promise<void> {
  loadEnv();
  const question = process.argv.slice(2).join(" ").trim();

  if (!question) {
    console.error('uso: npm run anden:ask -- "pregunta"');
    process.exitCode = 2;
    return;
  }
  if (question.length > MAX_QUESTION) {
    console.error(`la pregunta supera los ${MAX_QUESTION} caracteres`);
    process.exitCode = 2;
    return;
  }

  const userId = process.env.ANDEN_CLI_USER?.trim() || "cli";
  const result = await runHarness({ question, userId });

  console.log(result.answer);
  console.log("");

  if (result.steps.length) {
    console.log(`Pasos (${result.steps.length}):`);
    for (const [index, step] of result.steps.entries()) {
      const args = formatArgs(step.args);
      console.log(`  ${index + 1}. ${step.tool}(${args}) ${step.ok ? "ok" : "falló"} ${step.ms}ms`);
    }
  } else {
    console.log("Pasos: 0");
  }

  if (result.sources.length) {
    console.log(`Fuentes (${result.sources.length}):`);
    for (const source of result.sources) {
      console.log(`  - ${source.id} · ${source.title}`);
    }
  } else {
    console.log("Fuentes: 0");
  }

  console.log(
    `tokens: ${result.tokens} · costo: $${result.costUsd.toFixed(6)} · ${result.totalMs}ms` +
      (result.truncated ? " · truncada" : "")
  );
  console.log(`trace: ${result.traceId}`);
}

main().catch((error: unknown) => {
  if (error instanceof LlmConfigError) {
    console.error("falta la clave del modelo: ANDEN_LLM_KEY, o ANDEN_LLM_KEY en .env.local");
    process.exitCode = 2;
    return;
  }
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
