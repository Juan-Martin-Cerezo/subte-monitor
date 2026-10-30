import { getNextTrains } from '@subte/core';
import { optionalInteger, optionalString, requireString } from './args';
import type { AgentTool } from './types';

export const nextTrainsTool: AgentTool = {
  name: 'next_trains',
  description:
    'Upcoming arrivals at one station, sorted by ETA, with line, destination and minutes. Station names match without accents ' +
    'or case. Use when the question names one station and asks when the next train comes.',
  parameters: {
    type: 'object',
    properties: {
      station: { type: 'string', description: 'Station name, for example Medrano or Plaza de Mayo.' },
      line: { type: 'string', description: 'Optional line filter, for example LineaB or B.' },
      limit: { type: 'integer', minimum: 1, maximum: 20, description: 'Maximum number of arrivals. Defaults to 3.' },
    },
    required: ['station'],
    additionalProperties: false,
  },
  async execute(args) {
    return getNextTrains({
      station: requireString(args, 'station'),
      line: optionalString(args, 'line'),
      limit: optionalInteger(args, 'limit', 3, 1, 20),
    });
  },
};
