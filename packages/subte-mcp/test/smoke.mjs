import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const serverPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const base = process.env.SUBTE_API_BASE ?? "https://subte-monitor.vercel.app";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  env: { ...process.env, SUBTE_API_BASE: base },
  stderr: "inherit",
});

const client = new Client({ name: "subte-mcp-smoke", version: "1.0.0" });

async function callTool(name, args) {
  const result = await client.callTool({ name, arguments: args });
  const content = Array.isArray(result.content) ? result.content : [];
  const textBlock = content.find((block) => block.type === "text");
  assert.ok(
    textBlock && typeof textBlock.text === "string" && textBlock.text.length > 0,
    `${name} returned no text`
  );

  if (result.isError) {
    return { result, data: null, text: textBlock.text };
  }

  let data = null;
  try {
    data = JSON.parse(textBlock.text);
  } catch {
    assert.fail(`${name} returned non-JSON text: ${textBlock.text.slice(0, 200)}`);
  }

  return { result, data, text: textBlock.text };
}

async function callOk(name, args) {
  const first = await callTool(name, args);
  if (!first.result.isError) return first.data;

  if (/timed out|could not reach/i.test(first.text)) {
    const second = await callTool(name, args);
    assert.equal(second.result.isError, undefined, `${name} failed: ${second.text}`);
    return second.data;
  }

  assert.fail(`${name} failed: ${first.text}`);
}

async function main() {
  await client.connect(transport);

  const listed = await client.listTools();
  const names = listed.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, ["nearby_stations", "next_trains", "plan_trip", "subway_status"]);
  for (const tool of listed.tools) {
    assert.ok(
      tool.description && tool.description.length > 40,
      `${tool.name} has a thin description`
    );
    assert.ok(
      tool.inputSchema && tool.inputSchema.type === "object",
      `${tool.name} has no input schema`
    );
  }
  console.log(`tools/list ok: ${names.join(", ")}`);

  const status = await callOk("subway_status", {});
  assert.equal(typeof status.stale, "boolean");
  assert.equal(typeof status.alerts, "object");
  assert.equal(typeof status.alertCount, "number");
  assert.ok(status.feedAgeSeconds === null || typeof status.feedAgeSeconds === "number");
  assert.ok(!Number.isNaN(Date.parse(status.generatedAt)));
  console.log(
    `subway_status ok: stale=${status.stale} feedAge=${status.feedAgeSeconds}s alerts=${status.alertCount}`
  );

  const filtered = await callOk("subway_status", { line: "b" });
  assert.ok(Object.keys(filtered.alerts).every((line) => line === "LineaB"));
  console.log(`subway_status filter ok: ${JSON.stringify(Object.keys(filtered.alerts))}`);

  const arrivals = await callOk("next_trains", { station: "Uruguay" });
  assert.equal(arrivals.station, "Uruguay");
  assert.ok(Array.isArray(arrivals.arrivals));
  assert.ok(arrivals.arrivals.length > 0, "expected at least one live arrival");
  assert.ok(arrivals.arrivals.length <= 3);
  for (let i = 1; i < arrivals.arrivals.length; i++) {
    assert.ok(
      arrivals.arrivals[i - 1].etaSeconds <= arrivals.arrivals[i].etaSeconds,
      "arrivals are not sorted by ETA"
    );
  }
  for (const arrival of arrivals.arrivals) {
    assert.equal(typeof arrival.line, "string");
    assert.equal(typeof arrival.destination, "string");
    assert.equal(typeof arrival.etaSeconds, "number");
  }
  console.log(`next_trains ok: ${arrivals.arrivals.length} arrivals at ${arrivals.station}`);

  const caseInsensitive = await callOk("next_trains", { station: "AGUERO", limit: 1 });
  assert.equal(caseInsensitive.station, "Agüero");
  assert.ok(caseInsensitive.arrivals.length <= 1);
  console.log("next_trains accent/case match ok");

  const trip = await callOk("plan_trip", { from: "Agüero", to: "Plaza de Mayo" });
  assert.equal(trip.from, "Agüero");
  assert.equal(trip.to, "Plaza de Mayo");
  assert.ok(trip.totalStops > 0);
  assert.ok(trip.transferCount >= 0);
  assert.equal(trip.transferPoints.length, trip.transferCount);
  assert.equal(trip.legs.length, trip.transferCount + 1);
  assert.equal(trip.durationMinutes, trip.totalStops * 2 + trip.transferCount * 3);
  for (const leg of trip.legs) {
    assert.equal(typeof leg.line, "string");
    assert.equal(typeof leg.board, "string");
    assert.equal(typeof leg.alight, "string");
    assert.ok(leg.stops > 0);
  }
  console.log(
    `plan_trip ok: ${trip.totalStops} stops, ${trip.transferCount} transfers, ${trip.durationMinutes} min`
  );

  const stepFree = await callOk("plan_trip", {
    from: "Agüero",
    to: "Plaza de Mayo",
    step_free: true,
  });
  assert.equal(stepFree.stepFree, true);
  assert.ok(stepFree.transferPoints.every((point) => point.accessible === true));
  console.log(
    `plan_trip step-free ok: ${stepFree.totalStops} stops, ${stepFree.transferCount} transfers`
  );

  const nearby = await callOk("nearby_stations", { lat: -34.6037, lng: -58.3816 });
  assert.ok(nearby.count > 0);
  assert.equal(nearby.stations.length, nearby.count);
  for (let i = 1; i < nearby.stations.length; i++) {
    assert.ok(
      nearby.stations[i - 1].distanceMeters <= nearby.stations[i].distanceMeters,
      "stations are not sorted by distance"
    );
  }
  for (const station of nearby.stations) {
    assert.equal(typeof station.name, "string");
    assert.equal(typeof station.distanceMeters, "number");
    assert.ok(station.distanceMeters <= 800);
    assert.ok(Array.isArray(station.lines));
  }
  console.log(`nearby_stations ok: ${nearby.count} stations within ${nearby.radiusM}m`);

  const missing = await callTool("next_trains", { station: "Estacion Inventada" });
  assert.equal(missing.result.isError, true);
  assert.match(missing.text, /not found/);
  assert.match(missing.text, /Closest/);
  console.log("error mapping ok: unknown station");

  const ambiguous = await callTool("next_trains", { station: "Plaza" });
  assert.equal(ambiguous.result.isError, true);
  assert.match(ambiguous.text, /ambiguous/);
  assert.match(ambiguous.text, /Candidates/);
  console.log("error mapping ok: ambiguous station");

  const same = await callTool("plan_trip", { from: "Uruguay", to: "uruguay" });
  assert.equal(same.result.isError, true);
  assert.match(same.text, /same station/);
  console.log("error mapping ok: same station");

  const badLine = await callTool("subway_status", { line: "LineaZ" });
  assert.equal(badLine.result.isError, true);
  assert.match(badLine.text, /unknown line/);
  console.log("error mapping ok: unknown line");

  await client.close();
  console.log(`smoke test passed against ${base}`);
}

try {
  await main();
} catch (error) {
  console.error("smoke test failed:", error instanceof Error ? error.message : error);
  await client.close().catch(() => {});
  process.exit(1);
}
