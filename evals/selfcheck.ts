import { unresolvedCitations, unsupportedClaims } from './score';

let failures = 0;

function check(name: string, pass: boolean, detail = ''): void {
  if (pass) {
    console.log(`ok ${name}`);
    return;
  }
  failures += 1;
  console.log(`FAIL ${name}${detail ? `: ${detail}` : ''}`);
}

const cleanEvidence = [
  'Línea B opera con normalidad.',
  'El boleto cuesta 1817 pesos.',
  'El último tren sale a las 22:30.',
];
const cleanAnswer =
  'La Línea B opera con normalidad. El boleto cuesta $1.817,00 y el último tren sale a las 22:30 ' +
  '[kb:tarifa-subte-sube].';
const cleanFlags = unsupportedClaims(cleanAnswer, cleanEvidence);
check('clean answer is not flagged', cleanFlags.length === 0, cleanFlags.join(', '));

const stationFlags = unsupportedClaims(
  'La estación Plaza de Mayo está cerrada.',
  ['La estación Medrano está cerrada.'],
);
check(
  'invented station is flagged',
  stationFlags.includes('station:Plaza de Mayo'),
  stationFlags.join(', ') || 'no flags',
);

const fareFlags = unsupportedClaims('El boleto cuesta 2500 pesos.', ['El boleto cuesta 1817 pesos.']);
check(
  'invented fare is flagged',
  fareFlags.includes('number:2500'),
  fareFlags.join(', ') || 'no flags',
);

const timetableFlags = unsupportedClaims(
  'El último tren sale a las 23:45.',
  ['El último tren sale a las 22:30.'],
);
check(
  'contradictory timetable is flagged',
  timetableFlags.includes('number:23:45'),
  timetableFlags.join(', ') || 'no flags',
);

const retrieved = new Set(['kb:tarifa-subte-sube']);
const badAnswer = 'El boleto cuesta 1817 pesos [kb:tarifa-inexistente].';
const badCitations = unresolvedCitations(badAnswer, retrieved);
const goodCitations = unresolvedCitations('El boleto cuesta 1817 pesos [kb:tarifa-subte-sube].', retrieved);
check(
  'citation outside the retrieved set is rejected',
  badCitations.includes('kb:tarifa-inexistente') && goodCitations.length === 0,
  `bad=${badCitations.join(', ') || 'none'} good=${goodCitations.join(', ') || 'none'}`,
);

const total = 5;
if (failures) {
  console.error(`${failures}/${total} checks failed`);
  process.exitCode = 1;
} else {
  console.log(`${total}/${total} checks passed`);
}
