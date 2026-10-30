export const ABSTAIN = 'No tengo información sobre eso.';

export interface CitationCheck {
  answer: string;
  citations: string[];
  citationsValid: boolean;
}

export function validateCitations(answer: string, validIds: Iterable<string>): CitationCheck {
  const allowed = new Set(validIds);
  const citations: string[] = [];
  let citationsValid = true;

  const cleaned = answer.replace(/\[([^[\]\n]{1,120})\](?!\()/g, (_match, raw: string) => {
    const id = raw.trim();
    if (allowed.has(id)) {
      citations.push(id);
      return `[${id}]`;
    }
    citationsValid = false;
    return '';
  });

  return {
    answer: cleaned
      .replace(/[ \t]{2,}/g, ' ')
      .replace(/[ \t]+([.,;:!?])/g, '$1')
      .trim(),
    citations: [...new Set(citations)],
    citationsValid,
  };
}
