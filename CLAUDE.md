# Subte Monitor Developer Guidelines

## Build & Run Commands
- Run development server: `npm run dev`
- Build for production: `npm run build`
- Start production server: `npm run start`
- Lint checks: `npm run lint`

## Database Commands
- Generate Prisma Client: `npx prisma generate`
- Push schema to DB: `npx prisma db push`
- Run database seed: `npx prisma db seed`

## CRITICAL DATABASE SAFETY RULES (AI & Human Mandatory)
- **WARNING**: Do NOT point this project's `DATABASE_URL` to Kermingo's database endpoint under any circumstances! Doing so will wipe production ticket sales data.
- **DATABASE SHIELD**: The project has a security validation gate in `prisma.config.ts`. Do NOT remove, disable, or bypass this file or its validation logic. It is there to protect the Kermingo database from being accidentally overwritten.
- **DO NOT TOUCH** the `prisma.config.ts` file or modify the guard code that halts execution if `DATABASE_URL` contains `kermingo` or its production hostnames.
