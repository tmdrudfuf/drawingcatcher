// Offline source-inspection checks for the V1 combinatorial Character x
// Situation drawing-prompt generator. Same approach as
// 202609100014_milestone4g_random_drawing_prompts.test.ts: no live database,
// no db push -- this reads the migration's own SQL text, reconstructs the
// character/situation compatibility matrix exactly as
// generate_drawing_prompt's join condition would, and verifies structural
// properties of the resulting pool without ever calling Gemini or a real
// database.
//
// Run with:
//   npx deno test --allow-read=supabase/migrations supabase/migrations/202609100018_combinatorial_drawing_prompts.test.ts
import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const MIGRATION_PATH = new URL('./202609100018_combinatorial_drawing_prompts.sql', import.meta.url);

async function readMigration(): Promise<string> {
  return await Deno.readTextFile(MIGRATION_PATH);
}

interface Character {
  noun: string;
  article: 'a' | 'an';
  tags: string[];
}

type SituationType = 'universal' | 'tagged' | 'character_specific';

interface Situation {
  template: string;
  type: SituationType;
  requiredTags: string[];
  characterNoun: string | null;
}

function unescapeSql(raw: string): string {
  return raw.replace(/''/g, "'");
}

function parseCharacters(sql: string): Character[] {
  const block = sql.match(/insert into public\.prompt_characters \(noun, article, tags\) values([\s\S]*?);/);
  assert(block, 'could not locate the prompt_characters INSERT block');
  const rowPattern = /\('([a-z]+)', '(a|an)', (?:array\[([^\]]*)\]|'\{\}'::text\[\])\)/g;
  const characters: Character[] = [];
  for (const m of block![1].matchAll(rowPattern)) {
    const tags = m[3]
      ? [...m[3].matchAll(/'([a-z]+)'/g)].map((t) => t[1])
      : [];
    characters.push({ noun: m[1], article: m[2] as 'a' | 'an', tags });
  }
  return characters;
}

function parseSituations(sql: string): Situation[] {
  const situations: Situation[] = [];

  const universalBlock = sql.match(/insert into public\.prompt_situations \(template, situation_type\) values([\s\S]*?);/);
  assert(universalBlock, 'could not locate the universal prompt_situations INSERT block');
  const universalRow = /\('((?:[^']|'')*)', 'universal'\)/g;
  for (const m of universalBlock![1].matchAll(universalRow)) {
    situations.push({ template: unescapeSql(m[1]), type: 'universal', requiredTags: [], characterNoun: null });
  }

  const taggedBlock = sql.match(/insert into public\.prompt_situations \(template, situation_type, required_tags\) values([\s\S]*?);/);
  assert(taggedBlock, 'could not locate the tagged prompt_situations INSERT block');
  const taggedRow = /\('((?:[^']|'')*)', 'tagged', array\[([^\]]*)\]\)/g;
  for (const m of taggedBlock![1].matchAll(taggedRow)) {
    const requiredTags = [...m[2].matchAll(/'([a-z]+)'/g)].map((t) => t[1]);
    situations.push({ template: unescapeSql(m[1]), type: 'tagged', requiredTags, characterNoun: null });
  }

  const specificBlock = sql.match(/insert into public\.prompt_situations \(template, situation_type, character_noun\) values([\s\S]*?);/);
  assert(specificBlock, 'could not locate the character_specific prompt_situations INSERT block');
  const specificRow = /\('((?:[^']|'')*)', 'character_specific', '([a-z]+)'\)/g;
  for (const m of specificBlock![1].matchAll(specificRow)) {
    situations.push({ template: unescapeSql(m[1]), type: 'character_specific', requiredTags: [], characterNoun: m[2] });
  }

  return situations;
}

function isCompatible(character: Character, situation: Situation): boolean {
  if (situation.type === 'universal') return true;
  if (situation.type === 'tagged') return situation.requiredTags.every((t) => character.tags.includes(t));
  return situation.characterNoun === character.noun;
}

function assemble(character: Character, situation: Situation): string {
  const raw = `${character.article} ${character.noun} ${situation.template}`;
  return raw[0].toUpperCase() + raw.slice(1);
}

interface Pair {
  character: Character;
  situation: Situation;
  prompt: string;
}

function buildValidPairs(characters: Character[], situations: Situation[]): Pair[] {
  const pairs: Pair[] = [];
  for (const c of characters) {
    for (const s of situations) {
      if (isCompatible(c, s)) pairs.push({ character: c, situation: s, prompt: assemble(c, s) });
    }
  }
  return pairs;
}

// -- characters unique --------------------------------------------------
Deno.test('every character noun is unique', async () => {
  const characters = parseCharacters(await readMigration());
  assert(characters.length >= 25 && characters.length <= 30, `expected 25-30 characters, got ${characters.length}`);
  assertEquals(new Set(characters.map((c) => c.noun)).size, characters.length, 'duplicate character noun found');
});

// -- situations unique ----------------------------------------------------
Deno.test('every situation template is unique, and the pool is in the 30-40 range', async () => {
  const sql = await readMigration();
  const situations = parseSituations(sql);
  assert(situations.length >= 30 && situations.length <= 40, `expected 30-40 situations, got ${situations.length}`);
  assertEquals(new Set(situations.map((s) => s.template)).size, situations.length, 'duplicate situation template found');
});

// -- no empty final prompts -------------------------------------------------
Deno.test('no character noun, article, or situation template is empty', async () => {
  const sql = await readMigration();
  for (const c of parseCharacters(sql)) {
    assert(c.noun.trim().length > 0);
    assert(c.article === 'a' || c.article === 'an');
  }
  for (const s of parseSituations(sql)) {
    assert(s.template.trim().length > 0);
  }
});

// -- valid grammar/template assembly ----------------------------------------
Deno.test('every valid pair assembles into a well-formed sentence', async () => {
  const sql = await readMigration();
  const pairs = buildValidPairs(parseCharacters(sql), parseSituations(sql));
  assert(pairs.length > 0);
  for (const { prompt, character } of pairs) {
    // Starts with a capitalized article, matching the character's own
    // article exactly (case-insensitively), followed by the noun.
    const expectedStart = `${character.article[0].toUpperCase()}${character.article.slice(1)} ${character.noun} `;
    assert(prompt.startsWith(expectedStart), `"${prompt}" does not start with "${expectedStart}"`);
    assertFalse(prompt.includes('  '), `"${prompt}" contains a double space`);
    assertFalse(/^\s|\s$/.test(prompt), `"${prompt}" has leading/trailing whitespace`);
    // Only the first character is ever capitalized -- the rest of the
    // sentence must stay lowercase (no accidental mid-sentence capitals).
    assertEquals(prompt.slice(1), prompt.slice(1).toLowerCase(), `"${prompt}" has an unexpected capital letter`);
  }
});

// -- generated valid pairs unique (no two pairs assemble to the same text) --
Deno.test('no two valid (character, situation) pairs assemble into the same prompt string', async () => {
  const sql = await readMigration();
  const pairs = buildValidPairs(parseCharacters(sql), parseSituations(sql));
  const prompts = pairs.map((p) => p.prompt);
  assertEquals(new Set(prompts).size, prompts.length, 'two different pairs produced an identical prompt string');
});

// -- compatibility rules respected ------------------------------------------
Deno.test('tagged situations only pair with characters holding every required tag', async () => {
  const sql = await readMigration();
  const characters = parseCharacters(sql);
  const situations = parseSituations(sql);
  const tagged = situations.filter((s) => s.type === 'tagged');
  assert(tagged.length > 0, 'expected at least one tagged situation');
  for (const situation of tagged) {
    const eligible = characters.filter((c) => isCompatible(c, situation));
    assert(eligible.length > 0, `tagged situation "${situation.template}" has zero eligible characters`);
    for (const c of eligible) {
      for (const tag of situation.requiredTags) {
        assert(c.tags.includes(tag), `"${c.noun}" was deemed eligible for "${situation.template}" but lacks tag "${tag}"`);
      }
    }
    // Negative check: at least one character that visibly lacks a required
    // tag must be correctly excluded, proving the gate is not a no-op.
    const ineligible = characters.filter((c) => !isCompatible(c, situation));
    assert(ineligible.length > 0, `tagged situation "${situation.template}" excludes nobody -- the tag gate is a no-op`);
  }
});

// -- character-specific situations only appear for the intended character --
Deno.test('every character-specific situation pairs with exactly its one named character, never any other', async () => {
  const sql = await readMigration();
  const characters = parseCharacters(sql);
  const situations = parseSituations(sql);
  const specific = situations.filter((s) => s.type === 'character_specific');
  assert(specific.length > 0, 'expected at least one character-specific situation');
  for (const situation of specific) {
    assert(situation.characterNoun, `character_specific situation "${situation.template}" has no character_noun`);
    const eligible = characters.filter((c) => isCompatible(c, situation));
    assertEquals(eligible.length, 1, `"${situation.template}" should pair with exactly 1 character, got ${eligible.length}`);
    assertEquals(eligible[0].noun, situation.characterNoun);
  }
});

// -- immediate exact-pair repeat prevention (source-level) -------------------
Deno.test('generate_drawing_prompt excludes the immediately previous prompt, with a documented fallback', async () => {
  const sql = await readMigration();
  const fnMatch = sql.match(/create or replace function public\.generate_drawing_prompt\([\s\S]*?\nend;\n\$\$;/);
  assert(fnMatch, 'could not locate generate_drawing_prompt');
  const body = fnMatch![0];
  assert(body.includes('is distinct from p_previous_prompt'), 'must exclude the previous prompt from the primary pick');
  assert(body.includes('order by random()'), 'must select randomly');
  assert(/if v_prompt is null then/.test(body), 'must handle the zero-candidates-after-exclusion fallback');
  assert(body.includes("raise exception 'No drawing prompts are configured'"));
});

Deno.test('generate_drawing_prompt is never directly callable by anon/authenticated -- only the two RPCs call it internally', async () => {
  const sql = await readMigration();
  assert(sql.includes('revoke execute on function public.generate_drawing_prompt(text) from public;'));
  assertFalse(/grant execute on function public\.generate_drawing_prompt.*to anon/.test(sql));
});

// -- final prompt persists to rounds.prompt / shared by both players --------
Deno.test('both RPCs still insert the generated prompt into rounds.prompt via the same single-insert race guard', async () => {
  const sql = await readMigration();
  const startFn = sql.match(/create or replace function public\.start_round_if_ready\([\s\S]*?\nend;\n\$\$;/)![0];
  const nextFn = sql.match(/create or replace function public\.request_next_round\([\s\S]*?\nend;\n\$\$;/)![0];

  assert(startFn.includes("insert into rounds (game_id, round_number, prompt, status)"));
  assert(startFn.includes('on conflict (game_id, round_number) do nothing'));
  assert(startFn.includes('v_prompt := public.generate_drawing_prompt(null);'));

  assert(nextFn.includes("insert into rounds (game_id, round_number, prompt, status)"));
  assert(nextFn.includes('on conflict (game_id, round_number) do nothing'));
  assert(nextFn.includes('v_next_prompt := public.generate_drawing_prompt(v_previous_prompt);'));
});

Deno.test('both RPCs keep their existing (uuid, text) signature and anon grant -- zero client-side change required', async () => {
  const sql = await readMigration();
  assert(sql.includes('create or replace function public.start_round_if_ready(\n  p_game_id uuid,\n  p_actor_player_id text\n)'));
  assert(sql.includes('create or replace function public.request_next_round(\n  p_game_id uuid,\n  p_player_id text\n)'));
  assert(sql.includes('grant execute on function public.start_round_if_ready(uuid, text) to anon;'));
  assert(sql.includes('grant execute on function public.request_next_round(uuid, text) to anon;'));
  assertFalse(/drop function/i.test(sql), 'signatures are unchanged, so no drop should be needed');
});

// -- old difficult fixed examples are no longer part of selection -----------
Deno.test('neither RPC nor generate_drawing_prompt reference the old drawing_prompts pool anymore', async () => {
  const sql = await readMigration();
  const startFn = sql.match(/create or replace function public\.start_round_if_ready\([\s\S]*?\nend;\n\$\$;/)![0];
  const nextFn = sql.match(/create or replace function public\.request_next_round\([\s\S]*?\nend;\n\$\$;/)![0];
  const genFn = sql.match(/create or replace function public\.generate_drawing_prompt\([\s\S]*?\nend;\n\$\$;/)![0];
  for (const body of [startFn, nextFn, genFn]) {
    assertFalse(body.includes('drawing_prompts'), 'must not select from the old fixed pool any more');
  }
});

Deno.test('migration 202609100014 itself is not modified by this file (drawing_prompts table/rows left untouched)', async () => {
  const sql = await readMigration();
  assertFalse(/drop table.*drawing_prompts/i.test(sql));
  assertFalse(/delete from.*drawing_prompts/i.test(sql));
  assertFalse(/update.*drawing_prompts/i.test(sql));
});

// -- variety guardrail: no character is starved --------------------------
Deno.test('every character has a healthy minimum number of valid prompts (catches under-supported characters)', async () => {
  const sql = await readMigration();
  const characters = parseCharacters(sql);
  const situations = parseSituations(sql);
  const pairs = buildValidPairs(characters, situations);
  const perCharacter = new Map<string, number>();
  for (const c of characters) perCharacter.set(c.noun, 0);
  for (const p of pairs) perCharacter.set(p.character.noun, (perCharacter.get(p.character.noun) ?? 0) + 1);

  let min = Infinity;
  let max = 0;
  for (const [, count] of perCharacter) {
    min = Math.min(min, count);
    max = Math.max(max, count);
  }
  assert(min >= 18, `expected every character to have at least 18 valid prompts, lowest was ${min}`);
  assert(max - min <= 10, `variety spread too wide: min=${min} max=${max}`);
});

Deno.test('the total valid combination count is the expected 683 (regression guard against silent drift)', async () => {
  const sql = await readMigration();
  const pairs = buildValidPairs(parseCharacters(sql), parseSituations(sql));
  assertEquals(pairs.length, 683);
});
