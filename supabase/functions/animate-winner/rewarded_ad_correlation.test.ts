// Offline unit tests for the 'request-rewarded-ad-correlation' action's pure
// pieces. No network, no database -- issueRewardedAdCorrelation takes an
// injected fake admin client whose .rpc() calls are captured, and
// parseRequest is exercised directly against plain objects.
//
// Run with: npx deno test supabase/functions/animate-winner/rewarded_ad_correlation.test.ts
//
// Imports from ./shared.ts, deliberately NOT ./index.ts: index.ts has a
// bare top-level `Deno.serve(...)` call (unchanged, matching every other
// Edge Function in this project), which would run as an import side effect
// and start a live HTTP listener during `deno test`. shared.ts holds only
// pure request-parsing/correlation logic with no top-level side effects, so
// it is safe to import directly; index.ts imports the same functions from it.
import { assert, assertEquals, assertFalse } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { issueRewardedAdCorrelation, parseRequest } from './shared.ts';

interface RpcCall {
  name: string;
  args: Record<string, unknown>;
}

function fakeAdmin(rpcCalls: RpcCall[]) {
  return {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      return { data: { id: 'corr-1' }, error: null };
    },
  };
}

// L. valid correlation issuance -> contains no playerSecret and binds the
// correct winner (the server-resolved winner, never the requesting device).
Deno.test('L: issueRewardedAdCorrelation sends no player secret and binds the resolved winner, not the requester', async () => {
  const rpcCalls: RpcCall[] = [];
  const admin = fakeAdmin(rpcCalls);

  const result = await issueRewardedAdCorrelation(admin, {
    gameId: 'game-1',
    roundId: 'round-1',
    roundSubmissionId: 'submission-1',
    winnerPlayerId: 'winner-player',
    requestedByPlayerId: 'requesting-player', // deliberately different from winnerPlayerId
  });

  assertEquals(rpcCalls.length, 1);
  assertEquals(rpcCalls[0].name, 'issue_rewarded_ad_correlation');
  const args = rpcCalls[0].args;

  // Binds the WINNER, not the requester -- the whole point of resolving
  // winner_player_id server-side rather than trusting the caller's own id.
  assertEquals(args.p_winner_player_id, 'winner-player');
  assertEquals(args.p_requested_by_player_id, 'requesting-player');
  assertEquals(args.p_game_id, 'game-1');
  assertEquals(args.p_round_id, 'round-1');
  assertEquals(args.p_round_submission_id, 'submission-1');

  // No secret of any kind is ever part of the RPC payload.
  const serialized = JSON.stringify(args).toLowerCase();
  assertFalse(serialized.includes('secret'));

  // A fresh, high-entropy token was generated and returned exactly once,
  // and it is exactly what was hashed server-side (the RPC arg name is
  // p_token, plaintext, per the extensions.digest()-inside-SQL design) --
  // this test only asserts its shape, since the migration -- not this
  // function -- is what guarantees it's never stored as plaintext.
  assert(typeof args.p_token === 'string');
  assertEquals((args.p_token as string).length, 64); // 32 random bytes, hex-encoded
  assert(/^[0-9a-f]{64}$/.test(args.p_token as string));
  assertEquals(result.token, args.p_token);
  assert(result.expiresInSeconds > 0);
});

Deno.test('L: two issuances generate two different tokens', async () => {
  const rpcCalls: RpcCall[] = [];
  const admin = fakeAdmin(rpcCalls);
  const params = {
    gameId: 'game-1',
    roundId: 'round-1',
    roundSubmissionId: 'submission-1',
    winnerPlayerId: 'winner-player',
    requestedByPlayerId: 'winner-player',
  };
  const first = await issueRewardedAdCorrelation(admin, params);
  const second = await issueRewardedAdCorrelation(admin, params);
  assert(first.token !== second.token);
});

// H. correlation for wrong/non-winner submission -> no entitlement. This is
// a structural guarantee, not a runtime branch: the
// 'request-rewarded-ad-correlation' request shape accepts no
// roundSubmissionId/submission field from the client at all, so there is no
// channel for a caller to influence which submission a correlation binds to
// -- parseRequest only ever reads gameId/roundId/playerId/playerSecret for
// this action, and the Edge Function resolves the winning submission and
// winner_player_id itself (findWinningSubmissionForRoomMember +
// findRoundWinnerPlayerId in index.ts) before calling
// issueRewardedAdCorrelation. This test proves the parser drops any
// extraneous client-supplied submission-shaped field rather than acting on it.
Deno.test('H: parseRequest ignores any client-supplied submission id for request-rewarded-ad-correlation', () => {
  const parsed = parseRequest({
    action: 'request-rewarded-ad-correlation',
    gameId: 'game-1',
    roundId: 'round-1',
    playerId: 'player-1',
    playerSecret: 'secret-1',
    // An attacker-controlled field that does not exist on the real request
    // type -- if parseRequest ever started reading it, this test would need
    // updating, which is exactly the tripwire we want.
    roundSubmissionId: 'attacker-chosen-submission',
  } as Record<string, unknown>);

  assertEquals(parsed.action, 'request-rewarded-ad-correlation');
  assertEquals(Object.keys(parsed).sort(), ['action', 'gameId', 'playerId', 'playerSecret', 'roundId']);
  assertFalse('roundSubmissionId' in parsed);
});

// M4E step 3: rewarded-ad-status's request shape is exactly as minimal as
// the correlation-issuance action, and it is READ-ONLY -- it must never
// carry a client-supplied submission/entitlement/job id either.
Deno.test('rewarded-ad-status: parseRequest accepts only auth+scope fields, no ids', () => {
  const parsed = parseRequest({
    action: 'rewarded-ad-status',
    gameId: 'game-1',
    roundId: 'round-1',
    playerId: 'player-1',
    playerSecret: 'secret-1',
    entitlementId: 'attacker-chosen-entitlement',
  } as Record<string, unknown>);

  assertEquals(parsed.action, 'rewarded-ad-status');
  assertEquals(Object.keys(parsed).sort(), ['action', 'gameId', 'playerId', 'playerSecret', 'roundId']);
  assertFalse('entitlementId' in parsed);
});

// K. correlation issuance with invalid playerSecret -> rejected. Verified by
// inspection rather than re-tested here: the 'request-rewarded-ad-correlation'
// branch in index.ts calls verifyPlayerOwnership(admin, playerId, playerSecret)
// as its very first step, before findWinningSubmissionForRoomMember or
// issueRewardedAdCorrelation ever run -- the exact same ownership gate
// already used (and already proven) for the existing 'status' and
// 'reveal-status' actions. verifyPlayerOwnership itself is pre-existing,
// unmodified code that delegates to the verify_player_secret SQL RPC, which
// requires a live database to exercise and is out of scope for an offline
// unit test.
