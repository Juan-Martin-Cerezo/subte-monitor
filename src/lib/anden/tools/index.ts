import type { ToolDefinition } from '../llm';
import { nearbyStationsTool } from './nearby-stations';
import { nextTrainsTool } from './next-trains';
import { planTripTool } from './plan-trip';
import { searchKnowledgeTool } from './search-knowledge';
import { subwayStatusTool } from './subway-status';
import { toLlmTool, type AgentTool } from './types';

export const TOOLS: AgentTool[] = [
  subwayStatusTool,
  nextTrainsTool,
  planTripTool,
  nearbyStationsTool,
  searchKnowledgeTool,
];

export function toolByName(name: string): AgentTool | undefined {
  return TOOLS.find(tool => tool.name === name);
}

export function llmTools(): ToolDefinition[] {
  return TOOLS.map(toLlmTool);
}
