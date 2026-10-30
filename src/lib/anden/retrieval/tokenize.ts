const STOPWORDS = new Set(
  (
    'a al algo algunas algunos ante antes como con contra cual cuales cuando de del desde donde durante e el ella ellas ellos en entre era eran es esa esas ese eso esos esta estan estas este esto estos fue fueron ha habia han has hasta hay la las le les lo los mas me mi mis mucho muchos muy nada ni no nos nosotros o os otra otras otro otros para pero poco por porque que quien quienes se sea sean ser si sin sobre son su sus tambien tan tanto te tiene tienen todo todos tu tus un una uno unos vosotros y ya yo'
  ).split(' '),
);

function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

export function tokenize(value: string): string[] {
  return normalize(value)
    // keep line references as one token, so "línea B" matches routeId LineaB
    .replace(/\blinea\s+([a-h])\b/g, 'linea$1')
    .split(/[^a-z0-9]+/)
    .filter((token) => (token.length > 1 || /^\d+$/.test(token)) && !STOPWORDS.has(token));
}
