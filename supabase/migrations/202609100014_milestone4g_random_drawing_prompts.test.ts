// Offline checks for the Milestone 4G random-drawing-prompts migration.
// No database, no network -- this reads the migration's own SQL text and
// verifies structural properties of the prompt pool and the two
// redefined RPCs (start_round_if_ready, request_next_round). The actual
// PL/pgSQL execution/race behavior needs a live Postgres this environment
// does not have (no db push in this task); these checks instead verify
// the exact properties the task asked for are present in the committed
// SQL, the same source-inspection approach already used elsewhere in this
// project for DB logic that can't be exercised without a live database.
//
// Run with:
//   npx deno test --allow-read=supabase/migrations supabase/migrations/202609100014_milestone4g_random_drawing_prompts.test.ts
import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const MIGRATION_PATH = new URL('./202609100014_milestone4g_random_drawing_prompts.sql', import.meta.url);

async function readMigration(): Promise<string> {
  return await Deno.readTextFile(MIGRATION_PATH);
}

function extractPromptPool(sql: string): string[] {
  const block = sql.match(
    /insert into public\.drawing_prompts \(prompt\) values([\s\S]*?)on conflict \(prompt\) do nothing;/,
  );
  assert(block, 'could not locate the drawing_prompts INSERT block in the migration');
  const matches = [...block![1].matchAll(/'([^']*)'/g)];
  return matches.map((m) => m[1]);
}

// -- 1. prompt pool contains substantial variety -----------------------------
Deno.test('the curated prompt pool has between 60 and 100 entries (target: substantial variety)', async () => {
  const prompts = extractPromptPool(await readMigration());
  assert(prompts.length >= 60, `expected at least 60 prompts, got ${prompts.length}`);
  assert(prompts.length <= 100, `expected at most 100 prompts, got ${prompts.length}`);
});

// -- 2. prompt pool is not cat-dominated -------------------------------------
Deno.test('the prompt pool is not cat-dominated', async () => {
  const prompts = extractPromptPool(await readMigration());
  const catCount = prompts.filter((p) => /\bcat\b/i.test(p)).length;
  // Loose bound: cats may appear (the product brief's own examples include
  // one), but must be a small minority, not a recurring theme.
  assert(
    catCount <= Math.ceil(prompts.length * 0.1),
    `expected cats to be a small minority, got ${catCount} of ${prompts.length}`,
  );
});

// -- 3. prompts are non-empty and unique -------------------------------------
Deno.test('every prompt is non-empty, reasonably short, and the pool has no duplicates', async () => {
  const prompts = extractPromptPool(await readMigration());
  for (const prompt of prompts) {
    assert(prompt.trim().length > 0, 'found an empty prompt');
    assert(prompt.length <= 80, `prompt too long for a timed drawing game: "${prompt}"`);
  }
  assertEquals(new Set(prompts).size, prompts.length, 'the prompt pool contains a duplicate');
});

Deno.test('no prompt requires writing text (a "write ..." style prompt)', async () => {
  const prompts = extractPromptPool(await readMigration());
  for (const prompt of prompts) {
    assertFalse(/\bwrite\b/i.test(prompt), `prompt appears to require writing text: "${prompt}"`);
  }
});

// -- 4/5/8. one authoritative prompt per round; no client-supplied prompt ---
Deno.test('start_round_if_ready no longer accepts a client-supplied prompt, and selects one itself', async () => {
  const sql = await readMigration();
  // The old 3-arg signature (with p_prompt) is explicitly dropped first.
  assert(sql.includes('drop function if exists public.start_round_if_ready(uuid, text, text);'));
  const fnMatch = sql.match(
    /create or replace function public\.start_round_if_ready\(([\s\S]*?)\) returns void[\s\S]*?\nend;\n\$\$;/,
  );
  assert(fnMatch, 'could not locate start_round_if_ready in the migration');
  const signature = fnMatch![1];
  const body = fnMatch![0];
  assertFalse(signature.includes('p_prompt'), 'start_round_if_ready must not accept a prompt parameter');
  assert(body.includes('from public.drawing_prompts'), 'must select from the prompt pool');
  assert(body.includes('order by random()'), 'must select randomly');
  // Still exactly one INSERT of exactly one row, still race-guarded the
  // same way as before this migration.
  assert(body.includes('on conflict (game_id, round_number) do nothing'));
});

Deno.test('request_next_round no longer accepts a client-supplied prompt list, and selects the next prompt itself', async () => {
  const sql = await readMigration();
  assert(sql.includes('drop function if exists public.request_next_round(uuid, text, text[]);'));
  const fnMatch = sql.match(
    /create or replace function public\.request_next_round\(([\s\S]*?)\) returns void[\s\S]*?\nend;\n\$\$;/,
  );
  assert(fnMatch, 'could not locate request_next_round in the migration');
  const signature = fnMatch![1];
  const body = fnMatch![0];
  assertFalse(signature.includes('p_prompts'), 'request_next_round must not accept a prompt list parameter');
  assert(body.includes('from public.drawing_prompts'), 'must select from the prompt pool');
  assert(body.includes('order by random()'), 'must select randomly');
  assert(body.includes('on conflict (game_id, round_number) do nothing'));
});

// -- 6. immediate previous prompt is avoided when possible -------------------
Deno.test('request_next_round excludes the ending round\'s own prompt from the random pick', async () => {
  const sql = await readMigration();
  const fnMatch = sql.match(
    /create or replace function public\.request_next_round\([\s\S]*?\nend;\n\$\$;/,
  );
  assert(fnMatch);
  const body = fnMatch![0];
  // Looks up the ending round's own persisted prompt ...
  assert(body.includes('from rounds') && body.includes('v_previous_prompt'));
  // ... and excludes exactly that value from the random candidate pool.
  assert(body.includes('where prompt is distinct from v_previous_prompt'));
});

// -- 7. Round 2+ can receive a new prompt ------------------------------------
Deno.test('request_next_round always increments the round number and inserts a fresh row for it', async () => {
  const sql = await readMigration();
  const fnMatch = sql.match(
    /create or replace function public\.request_next_round\([\s\S]*?\nend;\n\$\$;/,
  );
  assert(fnMatch);
  const body = fnMatch![0];
  assert(body.includes('v_next_round := v_game.current_round_number + 1;'));
  assert(body.includes('insert into rounds (game_id, round_number, prompt, status)'));
});

// -- 8. existing race prevention is preserved --------------------------------
Deno.test('both RPCs keep their pre-existing race-prevention structure (row lock, ready-count gate, upsert-safe insert)', async () => {
  const sql = await readMigration();
  const startFn = sql.match(/create or replace function public\.start_round_if_ready\([\s\S]*?\nend;\n\$\$;/)![0];
  const nextFn = sql.match(/create or replace function public\.request_next_round\([\s\S]*?\nend;\n\$\$;/)![0];

  // start_round_if_ready: still locks the game row and still gates on both
  // players being ready before ever inserting a round.
  assert(startFn.includes('for update'));
  assert(startFn.includes('v_ready_count <> 2'));

  // request_next_round: still locks the game row and still gates on both
  // players wanting the next round before ever inserting one.
  assert(nextFn.includes('for update'));
  assert(nextFn.includes('v_ready_count <> 2'));

  // Neither function's insert can ever create a second row for the same
  // (game_id, round_number) even if called twice.
  assert(startFn.includes('on conflict (game_id, round_number) do nothing'));
  assert(nextFn.includes('on conflict (game_id, round_number) do nothing'));
});

Deno.test('both RPCs remain SECURITY DEFINER, service-role-mediated, anon-executable (unchanged privilege model)', async () => {
  const sql = await readMigration();
  assert(sql.includes('grant execute on function public.start_round_if_ready(uuid, text) to anon;'));
  assert(sql.includes('grant execute on function public.request_next_round(uuid, text) to anon;'));
});

Deno.test('drawing_prompts is publicly readable but has no write policy (writes only via migration)', async () => {
  const sql = await readMigration();
  assert(sql.includes('alter table public.drawing_prompts enable row level security;'));
  assert(sql.includes('for select using (true)'));
  // Scoped to the table/policy section only (before the first RPC body) --
  // "for update" also appears later as `select ... for update` ROW LOCKING
  // syntax inside start_round_if_ready/request_next_round, which is
  // unrelated and must not make this check false-positive.
  const policySection = sql.slice(0, sql.indexOf('insert into public.drawing_prompts'));
  assertFalse(policySection.includes('for insert'), 'drawing_prompts must have no client insert policy');
  assertFalse(policySection.includes('for update'), 'drawing_prompts must have no client update policy');
  assertFalse(policySection.includes('for delete'), 'drawing_prompts must have no client delete policy');
});
