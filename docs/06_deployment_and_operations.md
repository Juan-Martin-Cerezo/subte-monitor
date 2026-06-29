# Guide 06: Running, Deployment, & Production Operations

This document lists the step-by-step commands to configure, test, run, and deploy the `subte-monitor` project.

---

## 1. Local Configuration Check

Before running the application, make sure you have created your configuration files in the root folder:

### A. Environment Configuration File (`.env`)
Create a file named `.env` in the root folder and add the following keys:
```env
# Database Connection URL (PostgreSQL)
DATABASE_URL="postgresql://user:password@localhost:5432/subtemonitor"

# Buenos Aires City Transit Credentials (Optional - Defaults are used if empty)
SUBTE_CLIENT_ID="your_client_id"
SUBTE_CLIENT_SECRET="your_client_secret"
```

---

## 2. Command Reference Checklist

Execute these commands inside your project root folder:

### A. Install Project Dependencies
Run this command once before running the app to fetch all package requirements:
```bash
npm install
```

### B. Run the Local Development Server
Starts the application in development mode with hot reloading:
```bash
npm run dev
```
Open your browser at `http://localhost:3000` to preview the project.

### C. Build the Project for Production
Compiles and type-checks the source files, producing an optimized build folder:
```bash
npm run build
```

### D. Sync Schema to Database
Pushes model changes from `prisma/schema.prisma` directly to your database:
```bash
npx prisma db push
```

### E. Run the Database Seed Script
Populates the database with static GTFS network coordinates:
```bash
npx prisma db seed
```

---

## 3. Production Deployment (Vercel)

The application is deployed on Vercel. To deploy changes manually:

1.  Log in to Vercel via CLI if you haven't already:
    ```bash
    npx vercel login
    ```
2.  Run the production deployment command:
    ```bash
    npx vercel --prod --yes
    ```
    This uploads the code, builds it on the cloud, and updates the production URL:
    `https://subte-monitor.vercel.app`
