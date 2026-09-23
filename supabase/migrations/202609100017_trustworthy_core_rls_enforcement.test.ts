// Offline source-inspection checks for the Trustworthy Core Step 2B
// enforcement phase (phase 2 of 2 -- see 202609100016 for the RPC
// compatibility phase this depends on). Same approach as the other
// migration tests in this project: no live database, no db push -- this
// reads the migration's own SQL text and verifies its structural
// properties.
//
// Run with:
//   npx deno test --allow-read=supabase/migrations supabase/migrations/202609100017_trustworthy_core_rls_enforcement.test.ts
import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const MIGRATION_PATH = new URL('./202609100017_trustworthy_core_rls_enforcement.sql', import.meta.url);

async function readMigration(): Promise<string> {
  return await Deno.readTextFile(MIGRATION_PATH);
}

// -- exactly the four intended UPDATE policies are dropped ------------------
Deno.test('drops exactly the four Milestone-2 permissive UPDATE policies, and no others', async () => {
  const sql = await readMigration();
  assert(sql.includes('drop policy if exists "m2 games update lifecycle" on public.games;'));
  assert(sql.includes('drop policy if exists "m2 game players update flags" on public.game_players;'));
  assert(sql.includes('drop policy if exists "m2 rounds update lifecycle" on public.rounds;'));
  assert(sql.includes('drop policy if exists "m2 submissions update" on public.round_submissions;'));

  const dropPolicyLines = [...sql.matchAll(/^drop policy.*$/gim)];
  assertEquals(dropPolicyLines.length, 4, `expected exactly 4 drop policy statements, found ${dropPolicyLines.length}`);
});

// -- UPDATE revoked on exactly the four intended tables, both roles ---------
Deno.test('revokes table-level UPDATE from both anon and authenticated on exactly the four intended tables', async () => {
  const sql = await readMigration();
  for (const table of ['games', 'game_players', 'rounds', 'round_submissions']) {
    assert(
      new RegExp(`revoke update on table public\\.${table} from anon, authenticated;`).test(sql),
      `expected an UPDATE revoke for public.${table} covering both anon and authenticated`,
    );
  }

  const revokeLines = [...sql.matchAll(/^revoke update.*$/gim)];
  assertEquals(revokeLines.length, 4, `expected exactly 4 revoke statements, found ${revokeLines.length}`);
});

// -- no SELECT policy is dropped, no INSERT policy is changed ---------------
Deno.test('does not touch any SELECT or INSERT policy', async () => {
  const sql = await readMigration();
  assertFalse(/drop policy[\s\S]*?(readable|create|join)/i.test(sql), 'no SELECT/INSERT policy name should appear near a drop policy statement');
  assertFalse(/for select/i.test(sql), 'must not define/redefine a SELECT policy');
  assertFalse(/for insert/i.test(sql), 'must not define/redefine an INSERT policy');
  assertFalse(/revoke (select|insert|delete)/i.test(sql), 'must only revoke UPDATE, never SELECT/INSERT/DELETE');
});

// -- no RPC is created/replaced ----------------------------------------------
Deno.test('creates or replaces no function -- the RPCs already exist from 202609100016', async () => {
  const sql = await readMigration();
  assertFalse(/create (or replace )?function/i.test(sql), 'enforcement phase must not (re)create any RPC');
  assertFalse(/grant execute/i.test(sql), 'enforcement phase must never GRANT execute -- only REVOKE from authenticated is expected');
});

// -- authenticated EXECUTE is revoked on all four RPCs, anon is untouched ---
Deno.test('revokes authenticated EXECUTE on exactly the four RPCs, and never touches anon EXECUTE', async () => {
  const sql = await readMigration();
  assert(sql.includes('revoke execute on function public.set_ready(uuid, text, boolean) from authenticated;'));
  assert(sql.includes('revoke execute on function public.begin_drawing_round(uuid, text) from authenticated;'));
  assert(sql.includes('revoke execute on function public.mark_round_reveal(uuid, text) from authenticated;'));
  assert(sql.includes('revoke execute on function public.end_game(uuid, text) from authenticated;'));

  const revokeExecuteLines = [...sql.matchAll(/^revoke execute.*$/gim)];
  assertEquals(revokeExecuteLines.length, 4, `expected exactly 4 revoke execute statements, found ${revokeExecuteLines.length}`);
  for (const line of revokeExecuteLines) {
    assert(line[0].endsWith('from authenticated;'), `expected every revoke execute to target authenticated only, got: ${line[0]}`);
    assertFalse(/from anon/i.test(line[0]), `must never revoke anon EXECUTE, got: ${line[0]}`);
  }
});

// -- no unrelated tables are touched ------------------------------------------
Deno.test('touches only games, game_players, rounds, round_submissions -- not players, animation tables, or Storage', async () => {
  const sql = await readMigration();
  assertFalse(/\bon public\.players\b/.test(sql), 'must not touch a policy on public.players');
  assertFalse(/\btable public\.players\b/.test(sql), 'must not grant/revoke on public.players');
  assertFalse(/\b(on|table) public\.animation_jobs\b/.test(sql));
  assertFalse(/\b(on|table) public\.animation_entitlements\b/.test(sql));
  assertFalse(/storage\.objects|create bucket/.test(sql), 'must not touch Storage');
});

Deno.test('this migration is enforcement-only: exactly 12 statements (4 policy drops + 4 table UPDATE revokes + 4 function EXECUTE revokes)', async () => {
  const sql = await readMigration();
  const statementLines = sql
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('--'));
  assertEquals(statementLines.length, 12, `expected exactly 12 SQL statements, found: ${statementLines.join(' | ')}`);
});
