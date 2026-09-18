# Drawing Catcher — Monetization Strategy

## 1. Core Principle

Drawing Catcher's core gameplay must remain accessible for free.

Payment and forced advertising must not appear in the core multiplayer loop:

> Prompt → Draw → AI Judge → Results → Bring Them to Life → Next Round

Monetization should happen around the optional **Bring Them to Life** payoff, not during drawing or judging. The product must remain fun even when a player spends $0.

Preserve the existing product principle:

> **Preserve first. Stylize second.**

The value of animation is not cinematic quality by itself. The payoff is seeing the player's own strange, imperfect drawing become alive while preserving its identity.

## 2. Free Core Experience

Keep these features free:

- Create and join Duo games
- Prompt
- Drawing
- AI Judge
- Scores and results
- Next Round
- Basic Characterize experience
- Local character motion and animation

The free path should remain:

> Results → Bring Them to Life → Characterize — FREE → AI character image → local bounce, wiggle, or motion → Next Round

Characterize must not require watching an ad. Players must always be able to continue to the next round without watching an ad or buying anything.

## 3. Premium AI Video

Real generative AI video should be treated as a premium, optional payoff.

The desired flow is:

> Results → Bring Them to Life

The player then makes an explicit choice:

- **Characterize — FREE**
- **Animate — 1 Video Credit**

Animate produces the real AI-generated video. A paid video must not be generated automatically merely because a user reaches Reveal; the user must explicitly choose Animate.

## 4. Video Credits

Introduce a future product concept: the **Video Credit**.

One Video Credit represents permission to request one real AI animation. Possible ways to obtain Video Credits include:

1. Rewarded advertising or ad progress
2. Direct credit purchase
3. A future subscription allowance
4. Promotional or free credits

The backend must remain authoritative about credit ownership and consumption. Client-side events must never directly authorize expensive AI generation.

## 5. Rewarded Advertising

Do not permanently define **one rewarded ad = one AI video** as the business model. AI video generation may cost substantially more than the revenue from one rewarded ad.

Instead, rewarded ads should contribute toward a Video Credit:

> Watch rewarded ad → server-verified SSV reward → ad reward or progress → enough verified rewards → Video Credit

The exact number of ads required for one Video Credit must not be hardcoded as a permanent product rule yet. It should eventually be determined using real metrics such as:

- AdMob rewarded eCPM
- Country
- Platform
- Fill rate
- AI generation cost
- Store fees
- Infrastructure cost

The server should ultimately be able to adjust this ratio without requiring a new mobile app release.

## 6. Current Cost Assumption

> **Time-sensitive planning assumption:** These figures reflect the working cost comparison when this strategy was written. They are not permanent constants, and provider pricing must be checked again before production launch.

The planning assumption for a four-second Veo 3.1 720p generation is approximately:

| Tier | Assumed cost per second | Approximate cost for 4 seconds |
| --- | ---: | ---: |
| Veo Standard | $0.40 | $1.60 |
| Veo Fast | $0.10 | $0.40 |
| Veo Lite | $0.05 | $0.20 |

## 7. Preferred Cost Direction

Evaluate Veo Lite first for Drawing Catcher's production animation.

Drawing Catcher's primary value is not maximum cinematic fidelity. The important result is:

> **That weird drawing is now alive.**

If Lite preserves the following qualities well enough, lower generation cost may be substantially more valuable than additional cinematic quality:

- Silhouette
- Proportions
- Imperfections
- Recognizable identity
- Funny visual character

Do not switch models solely because of cost. Identity preservation remains the primary quality requirement.

## 8. Example Credit Pricing — Not Final

The following prices are hypotheses for later testing, not approved launch prices:

| Package | Example price |
| --- | ---: |
| 1 Video Credit | $0.99 |
| 5 Video Credits | $3.99 |
| 15 Video Credits | $8.99 |

Before finalizing prices, account for:

- Apple App Store fees
- Google Play fees
- Taxes
- AI video generation
- Characterization generation
- Supabase, storage, and bandwidth
- Failed-generation behavior
- Regional pricing

## 9. Subscription — Later, Not MVP

A future **Catcher+** subscription could potentially include:

- Monthly Video Credits
- Bonus Characterize styles
- History and storage features
- Cosmetic and social features
- Reduced advertising

An example concept is Catcher+ at approximately $4.99 per month. This is not an MVP requirement and is not an approved price.

Do not build subscription infrastructure until product behavior shows that users value Animate enough to justify it.

## 10. Example Player Experience

Two friends play five rounds.

In Round 1, they follow the free path:

> Draw → Judge → Results → Characterize → funny locally animated character → Next Round

The cost to the player is $0.

Later, one drawing is especially funny. At **Results → Bring Them to Life**, the player sees:

- **Characterize — FREE**
- **Animate — 1 Video Credit**

If the player has a credit, they may explicitly spend it and generate the video. If the player does not have a credit, the product may offer ways to obtain one, such as:

- Earn Video Credit
- Buy Video Credits

The player can always decline and continue playing.

## 11. UX Principle

Monetization must not interrupt the party-game rhythm.

Avoid:

- Forced interstitial ads between rounds
- Ads before drawing
- Ads before judging
- Mandatory ads to continue
- Automatic paid generation
- Aggressive purchase dialogs

Prefer monetization at moments when the player already feels:

> **This drawing is hilarious. I want to see this one come alive.**

The user's desire to preserve or share a particularly funny drawing should create the premium moment.

## 12. Existing AdMob / SSV Work

The current rewarded-ad server-side verification (SSV) implementation should not be discarded. Its architecture remains valuable:

> Google Rewarded Ad → Google SSV → cryptographic verification → transaction replay protection → opaque correlation → server-authoritative reward

However, the long-term meaning of the reward may change from:

> rewarded ad → immediate animation entitlement

to something closer to:

> rewarded ad → verified ad reward or progress → Video Credit → explicit Video Credit spend → animation entitlement

Do not redesign this yet. Finish validating the existing SSV pipeline first.

## 13. Paid Generation Safety

Maintain the existing hard invariant:

> Once `paid_generation_requested_at` is non-null for a `round_submission_id`, no future code path may send another Veo generation create request for that submission, regardless of failed or ambiguous provider state.

Future Video Credit implementation must preserve or strengthen this cost-safety invariant. A credit must never accidentally cause multiple paid provider requests.

## 14. Metrics

Continue tracking the original early product metric:

- Round 2 Start Rate

Also prepare to measure:

- Results → Bring Them to Life rate
- Bring Them to Life → Characterize selection rate
- Bring Them to Life → Animate selection rate
- Rewarded ad offer view rate
- Rewarded ad completion rate
- Video Credit acquisition rate
- Video Credit spend rate
- AI video generation success rate
- AI video share and save rate
- Rounds per session
- Return sessions

These metrics should determine future monetization decisions.

## 15. Decision Gates

Do not build the entire monetization system immediately. Use the following sequence:

1. **Phase 1:** Free game and Characterize
2. **Phase 2:** Validate Rewarded Ad SSV
3. **Phase 3:** Measure Animate intent
4. **Phase 4:** Test lower-cost AI video model quality
5. **Phase 5:** Introduce Video Credits
6. **Phase 6:** Test credit purchasing
7. **Phase 7:** Consider subscription only after sufficient evidence

## 16. Current Product Decision

Drawing Catcher will not depend on rewarded ads alone to pay for every AI video.

- The core game remains free.
- Characterize remains the default free **Bring Them to Life** payoff.
- Real AI video becomes an optional premium experience based on Video Credits.
- Rewarded advertising can contribute toward obtaining credits but must not be assumed to cover an AI video one-for-one.
- Purchases are expected to become the primary direct monetization mechanism for AI video if users demonstrate sufficient demand.
- Subscription remains a later possibility, not an MVP requirement.

## 17. Open Questions

Keep the following questions explicitly unresolved and answer them using product data rather than assumptions:

- Which Veo tier or model gives the best identity preservation per dollar?
- How many verified rewarded ads should equal one Video Credit?
- Should ad progress persist across sessions?
- Should both Duo players receive access to the generated video?
- Who spends the Video Credit?
- Can the losing drawing also be animated?
- What happens to a credit when generation fails?
- Should first-time users receive a free Video Credit?
- Should credits expire?
- What should regional pricing be?
- What share and save features increase willingness to animate?
- When, if ever, should Catcher+ be introduced?
