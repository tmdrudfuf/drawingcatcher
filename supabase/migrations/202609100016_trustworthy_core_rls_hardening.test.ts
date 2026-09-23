// Offline source-inspection checks for the Trustworthy Core Step 2B RPC
// compatibility phase (phase 1 of 2 -- see 202609100017 for the enforcement
// phase). Same approach as the other migration tests in this project: no
// live database, no db push -- this reads the migration's own SQL text and
// verifies its structural properties.
//
// Run with:
//   npx deno test --allow-read=supabase/migrations supabase/migrations/202609100016_trustworthy_core_rls_hardening.test.ts
import { assert, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const MIGRATION_PATH = new URL('./202609100016_trustworthy_core_rls_hardening.sql', import.meta.url);

async function readMigration(): Promise<string> {
  return await Deno.readTextFile(MIGRATION_PATH);
}

function extractFunctionBody(sql: string, name: string): string {
  const match = sql.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\nend;\\n\\$\\$;`));
  assert(match, `could not locate function ${name} in the migration`);
  return match![0];
}

// -- all four RPCs exist in SQL ----------------------------------------
Deno.test('all four replacement RPCs are defined', async () => {
  const sql = await readMigration();
  for (const name of ['set_ready', 'begin_drawing_round', 'mark_round_reveal', 'end_game']) {
    assert(
      new RegExp(`create or replace function public\\.${name}\\(`).test(sql),
      `expected public.${name} to be defined`,
    );
  }
});

// -- SECURITY DEFINER + pinned search_path -------------------------------
Deno.test('all four RPCs are SECURITY DEFINER with a pinned search_path', async () => {
  const sql = await readMigration();
  for (const name of ['set_ready', 'begin_drawing_round', 'mark_round_reveal', 'end_game']) {
    const body = extractFunctionBody(sql, name);
    assert(/security definer/i.test(body), `${name} must be SECURITY DEFINER`);
    assert(/set search_path = public/i.test(body), `${name} must pin search_path`);
  }
});

// -- membership checks exist ----------------------------------------------
Deno.test('all four RPCs verify game_players membership before mutating anything', async () => {
  const sql = await readMigration();
  for (const name of ['set_ready', 'begin_drawing_round', 'mark_round_reveal', 'end_game']) {
    const body = extractFunctionBody(sql, name);
    assert(
      /select 1 from game_players/i.test(body),
      `${name} must check game_players membership`,
    );
    assert(/raise exception/i.test(body), `${name} must reject a non-member rather than silently no-op`);
  }
});

Deno.test('set_ready writes only the ready column, never slot/player_id/game_id', async () => {
  const sql = await readMigration();
  const body = extractFunctionBody(sql, 'set_ready');
  const updateMatch = body.match(/update game_players\s+set ([\s\S]*?)\s+where/i);
  assert(updateMatch, 'could not locate the UPDATE statement in set_ready');
  const setClause = updateMatch![1];
  assertFalse(/\bslot\s*=/.test(setClause), 'set_ready must never write slot');
  assertFalse(/\bplayer_id\s*=/.test(setClause), 'set_ready must never write player_id');
  assertFalse(/\bgame_id\s*=/.test(setClause), 'set_ready must never write game_id');
  assert(/^ready\s*=\s*p_ready$/.test(setClause.trim()), `expected set_ready's SET clause to be exactly "ready = p_ready", got: ${setClause.trim()}`);
});

Deno.test('begin_drawing_round only transitions prompt to drawing, and resolves game_id server-side', async () => {
  const sql = await readMigration();
  const body = extractFunctionBody(sql, 'begin_drawing_round');
  assert(/select game_id into v_game_id\s+from rounds/i.test(body), 'must resolve game_id from the round itself, not a client-supplied value');
  assert(
    /update rounds\s+set status = 'drawing'\s+where id = p_round_id and status = 'prompt'/i.test(body),
    'begin_drawing_round must only ever perform the exact prompt -> drawing transition',
  );
  assertFalse(/set prompt\s*=/i.test(body), 'must never mutate the prompt column');
  assertFalse(/judge_/i.test(body), 'must never touch any judge_* column');
  assertFalse(/winner_player_id/i.test(body), 'must never touch winner_player_id');
});

Deno.test('mark_round_reveal only transitions results to reveal, and resolves game_id server-side', async () => {
  const sql = await readMigration();
  const body = extractFunctionBody(sql, 'mark_round_reveal');
  assert(/select game_id into v_game_id\s+from rounds/i.test(body), 'must resolve game_id from the round itself');
  assert(
    /update rounds\s+set status = 'reveal'\s+where id = p_round_id and status = 'results'/i.test(body),
    'mark_round_reveal must only ever perform the exact results -> reveal transition',
  );
  assertFalse(/set prompt\s*=/i.test(body));
  assertFalse(/judge_/i.test(body));
  assertFalse(/winner_player_id/i.test(body));
});

Deno.test('end_game is membership-checked, not host-only, and only writes status/ended_at', async () => {
  const sql = await readMigration();
  const body = extractFunctionBody(sql, 'end_game');
  assertFalse(/host_player_id/i.test(body), 'end_game must not restrict itself to the host');
  const updateMatch = body.match(/update games\s+set ([\s\S]*?)\s+where/i);
  assert(updateMatch, 'could not locate the UPDATE statement in end_game');
  const setClause = updateMatch![1];
  assert(/status\s*=\s*'ended'/.test(setClause));
  assert(/ended_at\s*=\s*now\(\)/.test(setClause));
  assertFalse(/current_round_number/.test(setClause), 'end_game must never touch current_round_number');
  assertFalse(/host_player_id\s*=/.test(setClause), 'end_game must never reassign host_player_id');
});

// -- PUBLIC execute revoked, anon execute granted --------------------------
Deno.test('every new function grants EXECUTE only to anon (never authenticated), after explicitly revoking the Postgres default PUBLIC grant', async () => {
  const sql = await readMigration();
  const grants = [...sql.matchAll(/grant execute on function public\.(\w+)\([^)]*\) to (\w+);/g)];
  const revokes = [...sql.matchAll(/revoke execute on function public\.(\w+)\([^)]*\) from (\w+);/g)];
  for (const name of ['set_ready', 'begin_drawing_round', 'mark_round_reveal', 'end_game']) {
    const grant = grants.find((g) => g[1] === name);
    const revoke = revokes.find((r) => r[1] === name);
    assert(grant, `expected an EXECUTE grant for ${name}`);
    assert(grant![2] === 'anon', `${name} should be granted to anon only, got ${grant![2]}`);
    assert(revoke, `expected a PUBLIC EXECUTE revoke for ${name}`);
    assert(revoke![2] === 'public', `${name}'s revoke should target public, got ${revoke![2]}`);
  }
});

// -- phase-1 discipline: this migration is purely additive ----------------
Deno.test('this migration is purely additive: no policy is dropped, no table UPDATE is revoked', async () => {
  const sql = await readMigration();
  assertFalse(/drop policy/i.test(sql), 'phase 1 must not drop any policy -- that is 202609100017\'s job');
  assertFalse(/revoke update on table/i.test(sql), 'phase 1 must not revoke table UPDATE -- that is 202609100017\'s job');
  assertFalse(/revoke (select|insert|delete)/i.test(sql), 'phase 1 must not touch SELECT/INSERT/DELETE privileges at all');
  assertFalse(/for select/i.test(sql), 'must not define a new SELECT policy');
  assertFalse(/for insert/i.test(sql), 'must not define a new INSERT policy');
  assertFalse(/create policy/i.test(sql), 'phase 1 creates RPCs only, never a new RLS policy');
});

Deno.test('touches only games, game_players, rounds, round_submissions via the four RPCs -- not players or animation tables', async () => {
  const sql = await readMigration();
  // Checks for actual DDL targets, not prose -- the migration's own comment
  // legitimately mentions "public.players" when explaining the precedent it
  // follows (202609100009), which must not trip this check.
  assertFalse(/\bon public\.players\b/.test(sql), 'must not define/drop a policy on public.players');
  assertFalse(/\btable public\.players\b/.test(sql), 'must not grant/revoke on public.players');
  assertFalse(/\b(on|table) public\.animation_jobs\b/.test(sql), 'must not touch animation_jobs DDL');
  assertFalse(/\b(on|table) public\.animation_entitlements\b/.test(sql), 'must not touch animation_entitlements DDL');
  assertFalse(/storage\.objects|create bucket/.test(sql), 'must not touch Storage');
});
