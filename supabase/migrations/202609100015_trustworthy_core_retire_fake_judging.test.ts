// Offline source-inspection checks for the Trustworthy Core Step 1 migration
// that retires public.complete_fake_judging. Same approach as
// 202609100014_milestone4g_random_drawing_prompts.test.ts: no live database,
// no db push -- this reads the migration's own SQL text and verifies its
// structural properties.
//
// Run with:
//   npx deno test --allow-read=supabase/migrations supabase/migrations/202609100015_trustworthy_core_retire_fake_judging.test.ts
import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const MIGRATION_PATH = new URL('./202609100015_trustworthy_core_retire_fake_judging.sql', import.meta.url);

async function readMigration(): Promise<string> {
  return await Deno.readTextFile(MIGRATION_PATH);
}

Deno.test('drops exactly the complete_fake_judging(uuid, uuid) function', async () => {
  const sql = await readMigration();
  assert(sql.includes('drop function if exists public.complete_fake_judging(uuid, uuid);'));
});

Deno.test('touches no other function, table, policy, or grant', async () => {
  const sql = await readMigration();
  // Only comment lines and the one `drop function` statement may exist --
  // guards against this migration quietly growing into broader RLS work,
  // which the task explicitly scoped out.
  const statementLines = sql
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('--'));
  assertEquals(statementLines.length, 1, `expected exactly one SQL statement, found: ${statementLines.join(' | ')}`);
  assertEquals(statementLines[0], 'drop function if exists public.complete_fake_judging(uuid, uuid);');

  // Checked against the actual statement text only (not the prose comment
  // block above it, which legitimately discusses grants/revokes/other
  // migrations in explaining *why* this one is scoped the way it is).
  const statementsOnly = statementLines.join(' ');
  assertFalse(/\balter table\b/i.test(statementsOnly));
  assertFalse(/\bcreate policy\b/i.test(statementsOnly));
  assertFalse(/\bdrop policy\b/i.test(statementsOnly));
  assertFalse(/\bgrant\b/i.test(statementsOnly));
  assertFalse(/\brevoke\b/i.test(statementsOnly));
  assertFalse(/\bcreate (or replace )?function\b/i.test(statementsOnly));
});

Deno.test('is a plain "if exists" drop, so it is safe to run even if 0001 was never applied or already partially cleaned up', async () => {
  const sql = await readMigration();
  assert(/drop function if exists/i.test(sql));
});
