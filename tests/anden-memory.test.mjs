import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildFact, validateFact } from '../src/lib/anden/facts.ts';
import { SqliteStore } from '../src/lib/anden/store/sqlite.ts';

function tempStore(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'anden-memory-'));
  const store = new SqliteStore(path.join(dir, 'anden.db'));
  t.after(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

const turn = (userId, question, answer, createdAt = new Date().toISOString()) => ({
  userId,
  question,
  answer,
  createdAt,
});

test('put, list and delete one fact', async (t) => {
  const store = tempStore(t);
  await store.init();
  const user = 'u-uno';

  await store.putFact(buildFact(user, 'home_station', 'Pueyrredon'));
  await store.putFact(buildFact(user, 'step_free', true));

  const facts = await store.listFacts(user);
  assert.deepEqual(
    facts.map((fact) => fact.key),
    ['home_station', 'step_free'],
  );
  assert.equal(facts[0].value, 'Pueyrredon');
  assert.equal(facts[1].value, true);

  assert.equal(await store.deleteFact(user, 'home_station'), true);
  assert.equal(await store.deleteFact(user, 'home_station'), false);
  assert.deepEqual(
    (await store.listFacts(user)).map((fact) => fact.key),
    ['step_free'],
  );
});

test('expired facts stay hidden and are removed lazily', async (t) => {
  const store = tempStore(t);
  await store.init();
  const user = 'u-ttl';

  const old = buildFact(user, 'usual_departure_time', '08:30', new Date('2026-01-01T00:00:00Z'));
  old.expiresAt = new Date('2026-01-02T00:00:00Z').toISOString();
  await store.putFact(old);
  await store.putFact(buildFact(user, 'usual_line', 'LineaB'));

  assert.deepEqual(
    (await store.listFacts(user)).map((fact) => fact.key),
    ['usual_line'],
  );
  assert.deepEqual(
    (await store.listFacts(user)).map((fact) => fact.key),
    ['usual_line'],
  );
});

test('delete all removes facts and turns for one user', async (t) => {
  const store = tempStore(t);
  await store.init();
  const user = 'u-borrar';

  await store.putFact(buildFact(user, 'work_station', 'Plaza de Mayo'));
  await store.putTurn(turn(user, '¿hasta qué hora la B?', 'Hasta las 23:32 [kb:ultimo-tren-linea-b].'));

  assert.equal(await store.deleteAll(user), 2);
  assert.equal((await store.listFacts(user)).length, 0);
  assert.equal((await store.recentTurns(user, 8)).length, 0);
});

test('two users do not see each other', async (t) => {
  const store = tempStore(t);
  await store.init();

  await store.putFact(buildFact('u-a', 'home_station', 'Acoyte'));
  await store.putFact(buildFact('u-b', 'work_station', 'Retiro'));
  await store.putTurn(turn('u-a', 'pregunta a', 'respuesta a'));

  assert.deepEqual(
    (await store.listFacts('u-a')).map((fact) => fact.key),
    ['home_station'],
  );
  assert.deepEqual(
    (await store.listFacts('u-b')).map((fact) => fact.key),
    ['work_station'],
  );

  await store.deleteAll('u-a');
  assert.equal((await store.listFacts('u-b')).length, 1);
  assert.equal((await store.recentTurns('u-b', 8)).length, 0);
});

test('invalid station and malformed values are rejected', () => {
  assert.equal(validateFact('home_station', 'Estacion Inventada'), null);
  assert.equal(validateFact('home_station', 'Pueyrredón'), 'Pueyrredon');
  assert.equal(validateFact('work_station', 'plaza de mayo'), 'Plaza de Mayo');
  assert.equal(validateFact('usual_line', 'línea b'), 'LineaB');
  assert.equal(validateFact('usual_line', 'LineaZ'), null);
  assert.equal(validateFact('usual_departure_time', '25:00'), null);
  assert.equal(validateFact('usual_departure_time', '8:05'), '08:05');
  assert.equal(validateFact('step_free', 'si'), null);
  assert.equal(validateFact('max_transfer_minutes', 500), null);
  assert.equal(validateFact('max_transfer_minutes', '15'), 15);
});

test('turns keep the last eight, newest last, and truncate text', async (t) => {
  const store = tempStore(t);
  await store.init();
  const user = 'u-turnos';
  const base = Date.now() - 10_000;

  for (let i = 1; i <= 10; i += 1) {
    await store.putTurn(turn(user, `pregunta ${i}`, `respuesta ${i}`, new Date(base + i * 1000).toISOString()));
  }

  const last = await store.recentTurns(user, 3);
  assert.deepEqual(
    last.map((item) => item.question),
    ['pregunta 8', 'pregunta 9', 'pregunta 10'],
  );
  assert.equal((await store.recentTurns(user, 50)).length, 8);

  await store.putTurn(turn(user, 'x'.repeat(900), 'y'.repeat(900)));
  const [latest] = (await store.recentTurns(user, 1));
  assert.equal(latest.question.length, 500);
  assert.equal(latest.answer.length, 500);
});

test('turns older than a day are dropped', async (t) => {
  const store = tempStore(t);
  await store.init();
  const user = 'u-viejo';

  await store.putTurn(turn(user, 'ayer', 'ayer', new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString()));
  assert.equal((await store.recentTurns(user, 8)).length, 0);
});
