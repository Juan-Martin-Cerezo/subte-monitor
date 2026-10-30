# Anden evals

This directory measures how often the Anden agent is wrong. Cases are hand written against the committed corpus and the station list. The runner drives the real agent, the real tools and the live model, then scores the result.

## Run

From the repository root:

```bash
npm run evals -- --subset 10 --max-cost 0.20
npm run evals -- --category memory --seed-facts
npm run evals -- --seed-facts --write-readme
npm run evals:validate
```

`npm run evals` needs a model key. It reads `ANDEN_LLM_KEY`, then `.env.local` in the repo root, the same path the app uses. Without a key the runner exits with code 2 before calling the model.

## Flags

| Flag             | Meaning                                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `--subset N`     | Run N cases, one per category in rotation. Use it for a cheap check.                                         |
| `--category X`   | Only `tool_selection`, `trip_planning`, `retrieval_citation`, `abstain` or `memory`.                         |
| `--seed-facts`   | Load each memory case's `user_facts` into a temporary sqlite database. Without it, memory cases are skipped. |
| `--max-cost USD` | Stop once the accumulated cost passes the limit. The run exits 1 when it stops early.                        |
| `--out path`     | Write the JSON result somewhere other than `evals/results/latest.json`.                                      |
| `--write-readme` | Replace the table between `<!-- evals:start -->` and `<!-- evals:end -->` in the root `README.md`.           |
| `--gate`         | Exit 1 when `hallucination_rate > 0.10` or `tool_accuracy < 0.85`. CI uses it.                               |

`--subset` takes one case per category per round, so a small run still touches every category. Memory cases are left out of the pool unless `--seed-facts` is passed.

## Cases

`cases.jsonl` has 50 lines. Each line is `{id, category, question, user_facts?, expect, notes}`.

| Category             | Cases | What it checks                                                                                                                                                                             |
| -------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tool_selection`     |    15 | The expected tool is called first. 11 positive cases and 4 negatives where `search_knowledge` or no tool is right.                                                                         |
| `trip_planning`      |    10 | `plan_trip` with the expected origin and destination. Two cases ask for a step-free route. The returned legs must start at the origin and never use the destination as a boarding station. |
| `retrieval_citation` |    10 | The answer cites an expected corpus id, every citation resolves to a retrieved source, and the answer does not abstain.                                                                    |
| `abstain`            |    10 | Impossible or out-of-scope questions return exactly `No tengo información sobre eso.`                                                                                                      |
| `memory`             |     5 | `user_facts` are seeded, the question omits the origin, and the agent must use the remembered `home_station`.                                                                              |

`npm run evals:validate` checks the schema without a key or network. It verifies the category counts, unique ids, known tool and fact names, real station names in arguments, and that every expected citation exists in the corpus.

## Metrics

| Metric                | How it is computed                                                                                                                                       |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tool_accuracy`       | Share of cases with a tool expectation where the expected tool was called. When the case sets `first: true`, it has to be the first call.                |
| `arg_accuracy`        | Share of cases with `args_contains` where the tool call carries every expected value. Station names and line names are compared without accents or case. |
| `citation_validity`   | Share of cases with `expect.cites` where the answer does not abstain, every bracketed id is in the retrieved set, and at least one expected id appears.  |
| `abstain_correctness` | Share of all cases where the answer abstained exactly when the case expected it, and did not abstain otherwise.                                          |
| `hallucination_rate`  | Share of cases with at least one unsupported station, line or number in the answer.                                                                      |
| `p50_ms`, `p95_ms`    | Wall clock per case, including tool calls to the live API.                                                                                               |
| `tokens`, `cost_usd`  | Sum of the model usage reported by the provider.                                                                                                         |

The full result, with every answer, tool call and check, goes to `evals/results/latest.json`. The root `README.md` gets the summary table with `--write-readme`.

## Hallucination checker

The primary check is deterministic and cheap. It does not call a second model.

- It strips citation ids, then looks for station names from `src/lib/anden/station-names.ts` and line names. A station or line counts as supported when the same normalized name appears in the question, the tool output or the seeded facts.
- It extracts numbers and times from the answer and compares them with the same values in the question and the evidence. `$1.817,00`, `1817` and `1.817` normalise to the same value. A number reported in seconds by a tool is accepted when the answer restates it in minutes.
- An answer with one unsupported value fails the case.

This is a proxy, not a semantic judge. It can miss a wrong claim that reuses a supported number, for example a price read from the wrong tier of the same table. It can also flag a correct figure that the model computed and that never appears in the evidence. The rule is deliberately conservative: every claim should trace back to a tool result or a cited source.

A model judge would be a second opinion only. It is not part of the current score.

## Cost

`config.json` holds the assumed price per 1M input and output tokens and the default cost limit. The numbers are an assumption for `deepseek-chat`. Change them when the provider or model changes. The runner prints a per-case cost table and stops when the accumulated cost passes `--max-cost`.

## What is not measured

- Answer style, tone and length.
- Latency of the live upstream, beyond reporting it.
- Feed outages. A tool error is a failed case, not a skipped one, so an outage lowers the score.
- Retrieval quality on its own. That is covered by `npm run anden:retrieval-eval` with the hand-written labels in `data/corpus/labels.jsonl`.
- A second judge or human review. The deterministic checker is the primary metric, as the stage requires.
- Consistency across repeated runs. The model runs at temperature 0, but providers do not guarantee identical output.

## CI

`.github/workflows/evals.yml` runs the offline parts on every push and pull request: `tsc`, the retrieval eval, the memory tests and the case validator. The live eval runs on `workflow_dispatch` with `ANDEN_LLM_KEY` from secrets, `--subset 15 --max-cost 0.10 --gate`. The gate fails the job above 10 percent hallucination or below 85 percent tool accuracy.
