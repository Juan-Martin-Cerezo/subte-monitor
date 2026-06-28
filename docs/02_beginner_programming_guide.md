# Guide 02: Programming Guide for Absolute Beginners

This guide is designed for individuals who have never programmed before. It explains the core concepts used in this project and walks through how to make changes or build a new feature from scratch.

---

## 1. Core Concepts Explained

Before writing code, it is important to understand the four building blocks of this application:

### A. React & Components
*   **What is it?**: React is a library for building user interfaces. It works by breaking down a website into modular, reusable building blocks called **Components**.
*   **Example**: The sidebar is a component, the map is a component, and the train tooltip is a component.
*   **State (`useState`)**: React components have memory. This memory is called "State". For example, when you click a line button, the screen remembers which line is active by saving it in a state variable. When state changes, React automatically redraws the component.

### B. TypeScript
*   **What is it?**: TypeScript is JavaScript with rules. It forces us to define what kind of data goes where.
*   **Why?**: If a function expects a number (like train progress: `0.5`), TypeScript will alert you with a red underline if you try to give it text (like `"almost there"`), preventing bugs before you run the app.

### C. App Routing (Next.js)
*   **What is it?**: Next.js uses files to define pages and endpoints.
*   **Page Routing**: Any file named `page.tsx` inside the `src/app/` folder is rendered as a webpage.
*   **API Routing**: Any file named `route.ts` inside `src/app/api/` handles API requests. For example, when the frontend fetches `/api/telemetry`, the code in `src/app/api/telemetry/route.ts` runs.

### D. CSS and Styling (Tailwind CSS)
*   **What is it?**: Tailwind allows us to style HTML directly inside our files using utility classes.
*   **Example**: Instead of writing separate stylesheets, you write classes like `p-4` (padding of 4), `bg-slate-900` (dark background color), and `text-white` (white text color) directly on your HTML tags.

---

## 2. Walkthrough: Adding a New Field to the UI

Let's assume you want to add a simple alert or notification message to the top of the sidebar. Here is how you can do it step by step.

### Step 1: Open the Main Dashboard Code
The dashboard UI lives in `src/components/SubteDashboard.tsx`. Open this file.

### Step 2: Locate the Sidebar Layout
Search for the side panel container. In this project, it is marked with the comment:
`{/* SideNavBar (Desktop Only) */}` (around line 1005).

Inside it, you will see a list of navigation buttons:
```tsx
<aside className="hidden md:flex w-64 shrink-0 h-full flex-col ...">
  ...
</aside>
```

### Step 3: Insert Your Element
If you want to add a custom alert box at the top of the navigation list, insert this code inside the navigation list (`<nav>` tag):
```tsx
<div className="bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-xs p-3 rounded-lg mx-2 mb-3">
  <strong>Aviso:</strong> La línea D presenta demoras menores por obras de renovación de vías.
</div>
```

### Step 4: Verify Locally
Run the development server by executing `npm run dev` in your terminal. Open your browser at `http://localhost:3000` to see your new banner displayed.

---

## 3. How to Create an API Endpoint from Scratch

If you want to build a new feature that needs data from a database or external website, you will need to create a new API route.

1.  Create a folder in `src/app/api/` named after your feature (e.g., `src/app/api/hello/`).
2.  Create a file inside that folder called `route.ts`.
3.  Add the following code to return a JSON response:
    ```typescript
    import { NextResponse } from 'next/server';

    export async function GET() {
      return NextResponse.json({ message: "Hello from Subte Monitor API!" });
    }
    ```
4.  You can test this endpoint by visiting `http://localhost:3000/api/hello` in your browser.
