import { getStatus } from '@subte/core';
import { optionalString } from './args';
import type { AgentTool } from './types';

export const subwayStatusTool: AgentTool = {
  name: 'subway_status',
  description:
    'Official service alerts, per line, plus how fresh the live feed is. Use for questions about how the service is running, ' +
    'current alerts or closures. Not for arrival times; use next_trains for those.',
  parameters: {
    type: 'object',
    properties: {
      line: {
        type: 'string',
        description: 'Optional line filter, for example LineaB or B. Omit it for all lines.',
      },
    },
    additionalProperties: false,
  },
  async execute(args) {
    return getStatus(optionalString(args, 'line'));
  },
};
