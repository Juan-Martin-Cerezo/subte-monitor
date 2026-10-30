import { search } from '../retrieval';
import { optionalInteger, requireString } from './args';
import type { AgentTool } from './types';

export const searchKnowledgeTool: AgentTool = {
  name: 'search_knowledge',
  description:
    'Search the written knowledge base: first and last train hours, fares and SUBE discounts, accessibility per station, ' +
    'line station lists, transfer rules, current official alerts and how this app works. Returns sources with ids. ' +
    'Cite the id of the source that supports each claim, for example [kb:tarifa-subte-sube].',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'What to look up, in Spanish, using the words from the question.' },
      k: { type: 'integer', minimum: 1, maximum: 10, description: 'Number of sources to return. Defaults to 6.' },
    },
    required: ['query'],
    additionalProperties: false,
  },
  async execute(args) {
    const query = requireString(args, 'query');
    const sources = await search(query, optionalInteger(args, 'k', 6, 1, 10));
    return { query, count: sources.length, sources };
  },
};
