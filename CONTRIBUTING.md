# Contributing

Thanks for taking the time. The project is small and maintained by one person, so the most useful contributions come with context: an issue that reproduces the problem, or a pull request scoped to one change.

## Before you start

- Search the open issues first.
- For larger changes (a new screen, a different telemetry strategy), open an issue and discuss the approach.
- For typos, docs and small fixes, send the pull request directly.

## Setup

```bash
git clone https://github.com/Juan-Martin-Cerezo/subte-monitor.git
cd subte-monitor
npm install
cp .env.example .env.local
```

You need Node 20 or newer, a PostgreSQL database, and a GCBA API key. Then:

```bash
npm run db:push    # create the tables
npm run db:seed    # load stations and route sequences from gtfs.zip
npm run dev
```

`gtfs.zip` is committed, so the seed works offline. If you delete it, the script re-downloads it using your credentials.

## Required checks

All of them run in CI. A pull request that fails any of these does not get merged.

```bash
npm run format:check
npm run lint
npm run typecheck
npm run build
```

## Style

- TypeScript strict, no new `any`.
- Code and comments in English; user facing copy in Spanish.
- No new dependencies when the standard library or what is already installed does the job.
- Comment the why, not the syntax. Line-by-line narration of what an import does does not belong in the code.

## Pull requests

- One topic per pull request.
- Describe the problem before the solution, and how you tested it.
- If you change the schema, add the migration to `prisma/schema.prisma` and mention it in the description.
- If you touch a screen, attach a screenshot.

## Data

Do not commit scraped dumps or third party datasets. `gtfs.zip` is the official GCBA feed and stays as is.
