import type { ToolDefinition as LlmTool } from "../llm";

export interface AgentTool {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties: boolean;
  };
  execute(args: Record<string, unknown>): Promise<unknown>;
}

export function toLlmTool(tool: AgentTool): LlmTool {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
