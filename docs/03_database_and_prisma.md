# Guide 03: Database Models & Schema Guide

This document explains the data models of our application, how the database schema is defined using Prisma ORM, how to apply changes, and how the network details are initialized.

---

## 1. Database Schema File Overview

Our database is managed using Prisma. The definitions of all database tables (models) are saved inside the file:
`prisma/schema.prisma`

### Model Descriptions

#### A. Station Model (Station)
Stores the physical locations of stations.
*   `stopId` (String, Primary Key): Unique GTFS ID representing the station platform (e.g. `9 de Julio` platform has one ID for north and one for south).
*   `stopName` (String): The human-readable name of the station (e.g. "Congreso de Tucumán").
*   `latitude` (Float) & `longitude` (Float): Spatial coordinates of the station.

#### B. RouteSequence Model (RouteSequence)
Maps stations to their corresponding line and ordering.
*   `routeId` (String): Identifies the line (e.g. `LineaD`, `PM-Civico`).
*   `directionId` (Int): 0 for outbound trips, 1 for return trips.
*   `stopSequence` (Int): The physical order number of the station on the track (from 1 to N).
*   `stopId` (String): Reference to the physical `Station`.

#### C. Report Model (Report)
Stores user-reported incidents (delay notifications, escalator breakdowns, etc.).
*   `line` (String): The route affected.
*   `station` (String): Normalized station name where the issue occurred.
*   `category` (String): The problem type (e.g., "Demora", "Frecuencia").
*   `comment` (String): User's description.
*   `createdAt` (DateTime): Automated timestamp.

---

## 2. Common Database Tasks & Commands

To modify database structures, run the following commands in your terminal:

### A. How to Update the Database Schema
1.  Open `prisma/schema.prisma`.
2.  Modify or add fields. For example, to add an `email` field to the `Report` model:
    ```prisma
    model Report {
      ...
      userEmail String?
    }
    ```
3.  Save the file.
4.  Run `npx prisma db push` to synchronize your local database structure with the schema.
5.  Run `npx prisma generate` to rebuild the TypeScript client libraries so your code recognizes the new fields.

### B. Seeding the Database
The project contains static GTFS station coordinates and sequence routes. To populate the database with these default records:
1.  Run the command:
    ```bash
    npx prisma db seed
    ```
    This script executes `prisma/seed.ts`, parses the GTFS coordinates, and uploads them to your database.

---

## 3. Database Safety Guards (CRITICAL)

To prevent developer errors from wiping production database sales data (such as accidentally pointing migrations to Kermingo's database), a database shield configuration is enabled:
*   **Protection File**: `prisma.config.ts`
*   **Action**: Halts execution immediately if the environment variable `DATABASE_URL` contains the substring `kermingo`.
*   **Rules**: Never edit, remove, or bypass this configuration.
