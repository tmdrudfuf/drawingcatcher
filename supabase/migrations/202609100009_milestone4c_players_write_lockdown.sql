-- Milestone 4C Step 5C: direct players write lockdown.
--
-- Player registration and display-name updates now go through the
-- SECURITY DEFINER register_or_touch_player function. Keep the existing
-- SELECT grants and RLS policies unchanged, but prevent client roles from
-- writing directly to the table even if an INSERT/UPDATE policy permits it.

revoke insert, update on table public.players from public;
revoke insert, update on table public.players from anon;
revoke insert, update on table public.players from authenticated;
