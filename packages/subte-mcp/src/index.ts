#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { registerNextTrainsTool } from './tools/next-trains.js';
import { registerNearbyTool } from './tools/nearby.js';
import { registerPlanTripTool } from './tools/plan-trip.js';
import { registerStatusTool } from './tools/status.js';

const server = new McpServer({ name: 'subte-mcp', version: '0.1.0' });

registerStatusTool(server);
registerNextTrainsTool(server);
registerPlanTripTool(server);
registerNearbyTool(server);

const transport = new StdioServerTransport();

server.connect(transport).catch(error => {
  console.error('subte-mcp failed to start:', error instanceof Error ? error.message : error);
  const runtime = globalThis as { process?: { exitCode?: number } };
  if (runtime.process) runtime.process.exitCode = 1;
});
