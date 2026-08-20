# Can every card have a chance without minting the whole box?

Companion to [`rarity-and-booster-plan.md`](rarity-and-booster-plan.md). The question is
whether a hard supply cap forces a premine, or whether packs can be drawn on demand so
that every card has a chance in every pack.

Short answer: **the premine is not required, but an urn is.** Those are different things,
and the current implementation conflates them. Below is the proof, then the construction
that gets the property you want without the premine.

## 0. Notation

- $n$ — number of packs the mint will ever sell
- $c_i$ — the supply cap on card $i$ (for Genesis, $c_i = 21$)
- $N_i$ — the number of copies of card $i$ that actually end up minted
- $p_i$ — the probability that a given pack contains card $i$

Three properties we might want:

- **(I) Independence.** Pack contents are i.i.d. Every card has a fixed probability
  $p_i > 0$ in every pack, forever, regardless of what came before.
- **(C) Hard cap.** $\Pr[N_i \le c_i] = 1$. Not "on average 21". Exactly at most 21,
  always, provable.
- **(V) Volume.** $n > c_i$ — we sell more packs than the cap on the scarcest card.
  For us $n = 20{,}993$ and $c_i = 21$, so this holds by a factor of a thousand.

## 1. Theorem: (I), (C) and (V) cannot all hold

*Proof.* Assume (I). Then $N_i \sim \mathrm{Bin}(n, p_i)$ with $p_i > 0$, so the support of
$N_i$ is all of $\{0, 1, \dots, n\}$. In particular

$$\Pr[N_i = n] = p_i^{\,n} > 0.$$

By (V), $n > c_i$, so the event $\{N_i = n\}$ is contained in $\{N_i > c_i\}$, giving

$$\Pr[N_i > c_i] \ \ge\ p_i^{\,n} \ >\ 0,$$

which contradicts (C). $\blacksquare$

**Corollary 1.** Any mechanism that enforces a hard cap must make packs *dependent*. The
$k$-th pack must be conditioned on packs $1 \dots k-1$. There is no way around this: it is
the definition of a cap.

**Corollary 2.** "Draw independently, but stop when the card sells out" does not escape the
theorem — it *is* the escape. Rejection sampling from a depleting pool is exactly sampling
without replacement. That mechanism is an urn. So is "reweight the odds as stock runs
down", and so is every other cap you can write down. **Every cap-respecting mechanism is
an urn.** The only freedom left is *when the urn is shuffled and who knows the order.*

## 2. The premise is false: an urn does give every card a chance

The worry behind the question is that a fixed box means a card's fate is sealed. It is
not. In an urn with $r_i$ copies of card $i$ left in a remaining pool of $R$, drawing $s$
slots:

$$\Pr[\text{card } i \in \text{next pack}] \;=\; 1 - \frac{\binom{R - r_i}{s}}{\binom{R}{s}} \;>\; 0 \quad\text{whenever } r_i \ge 1.$$

Concretely, in the proposed prime-slot pool of 20,997:

| copies left | pool | P(in the next pack) |
|---|---|---|
| 21 | 20,997 | 1 in 1,000 |
| 5 | 20,997 | 1 in 4,199 |
| 1 | 20,997 | 1 in 20,997 |
| 1 | 2,099 (90% depleted) | 1 in 2,099 |

Strictly positive at every step until the card is genuinely gone — and it being gone is
precisely what "21 copies exist" means. **"Every card has a chance in every pack" and "hard
cap" are compatible.** What is *not* compatible is "every card has the same fixed
independent chance forever", which is (I), which the theorem rules out.

## 3. What independent draws would actually cost

Suppose we ignored the theorem and ran (I) anyway — on-demand packs, fixed odds, no urn.
Supply becomes a random variable. Over 20,993 packs:

| tier | target | mean | sd | rel. sd | 95% of mints land in |
|---|---|---|---|---|---|
| Common | 851 | 851.1 | 28.6 | 3.4% | 795 .. 907 |
| Uncommon | 221 | 221.0 | 14.8 | 6.7% | 192 .. 250 |
| Rare | 207 | 207.0 | 14.3 | 7.0% | 179 .. 235 |
| Junction | 58 | 58.0 | 7.6 | 13.1% | 43 .. 73 |
| **Genesis** | **21** | 21.0 | 4.6 | **21.8%** | **12 .. 30** |

For a single 21-copy Genesis card:

| event | probability | odds |
|---|---|---|
| lands exactly on 21 | 0.0868 | 1 in 12 |
| $\le 10$ — half the intended supply | 0.0062 | 1 in 160 |
| $\ge 32$ — 1.5x the cap | 0.0151 | 1 in 66 |
| $\ge 42$ — double the cap | 0.000035 | 1 in 28,704 |

Across the nine Genesis cards:

- $\Pr[\text{at least one exceeds 1.5x its cap}] = \mathbf{12.8\%}$
- $\Pr[\text{at least one ends below half supply}] = \mathbf{5.5\%}$
- $\Pr[\text{all nine land exactly on 21}] = 2.8\times10^{-10}$, one in 3.6 billion

So under independent draws the sentence "only 21 of these exist" is false with probability
essentially 1, and *visibly* false — off by 50% or more — better than one time in eight.

The structural reason is worse than the numbers. Relative error is $1/\sqrt{T}$ in the
target $T$:

| tier | target | relative sd |
|---|---|---|
| Common | 851 | ±3.4% |
| Uncommon | 221 | ±6.7% |
| Rare | 207 | ±7.0% |
| Junction | 58 | ±13.1% |
| Genesis | 21 | **±21.8%** |

**Independent draws control scarcity worst exactly where scarcity is the entire product.**
The commons, which nobody cares about, come out accurate to 3%. The card the whole set is
built around is a coin flip.

In an urn, all of these variances are identically zero.

## 4. The real axis is not premine vs. on-demand

Corollary 1 says we need an urn. It says nothing about *when the shuffle happens*. That is
a free choice, and it is the choice that actually matters:

| scheme | supply exact | order fixed at | who can predict a pack |
|---|---|---|---|
| **A. eager shuffle, seed published** | yes | mint time | **everyone** |
| A′. eager shuffle, seed withheld | yes | mint time | **the mint** |
| **C. lazy shuffle, public beacon** | yes | open time | **nobody** |
| B. independent draws | **no** | open time | nobody |

Scheme C gives everything B gives — nothing is decided before you buy, every card has a
chance in every pack — *and* keeps the exact cap. **B is strictly dominated.** There is no
trade-off to make here; there is simply a better construction.

### We are currently running A, in its weakest form

`site/shop-data.js` publishes `seed: 600` **and** the entire 4,535-entry ordered `box`
array in plaintext, because `site/shop.js` deals packs client-side and therefore needs it.

A commitment is supposed to be *binding* (nobody can change it afterwards) and *hiding*
(nobody learns the value early). This one is binding only. The consequence is concrete:

```
E1-001 Genesis Lotus sits at box positions 354, 3107, 4387
                     -> packs 71, 622 and 878
```

Anyone can read that off the published file and buy pack 71. Every pack in the set is
mapped before the first sale. This is not a flaw in the idea of a premine — it is what
client-side dealing forces, and it is the thing worth fixing regardless of which rarity
curve we ship.

## 5. Scheme C: bounded urn, lazy shuffle

Keep the exact multiset. Do not fix the order. Derive each draw from randomness that does
not exist yet at mint time.

1. **Commit to composition, not order.** Publish $H(\text{counts} \parallel \text{salt})$ —
   the census of the urn. Binding on supply, and it reveals no ordering because there is
   none yet.
2. **Draw from a beacon.** For pack $k$, take $\rho_k = H(B_k \parallel \text{pack\_id})$
   where $B_k$ is the first Bitcoin block hash after the payment settles. Map $\rho_k$ onto
   the remaining pool per slot.
3. **Publish the running state.** Remaining counts after each pack, chained so the log
   cannot be rewritten.
4. **Verify.** Anyone replays every draw from the public beacons and the published census
   and confirms the log. Client-side verifiability survives; client-side *precomputation*
   does not, because $B_k$ has not been mined yet.

Neither the buyer nor the mint chooses $B_k$. A miner could, by discarding a block they
found:

| | |
|---|---|
| whole mint revenue | 104,966 cards × 21,000 msat = **0.022 BTC** |
| cost of discarding one block to re-roll | **3.125 BTC** + fees |
| one re-grind, as a multiple of the entire mint | **142×** |
| chance a re-grind hits a chosen Genesis | 0.001 |
| expected cost to force one Genesis | **3,125 BTC** ≈ 142,000× the mint |

A miner burns more than the whole set is worth, 142 times over, to steer a card that sells
for 21,000 msat. If that margin ever feels thin, use two blocks, or fold in a buyer-chosen
nonce via commit–reveal, which is unbiasable if *either* party is honest.

## 6. The one thing no scheme fixes

A hard cap creates an observable endgame, in A and C alike, and in physical cardboard too —
this is the same effect as box mapping in paper Magic.

Genesis cards remaining in the last 10% of the mint (2,099 packs): mean 2.10, sd 1.30. If
the market has watched the sale and no Genesis has surfaced by 90% depletion, all 21 are
still in the tail:

$$\frac{21}{2{,}099} = 1.00\% \text{ per pack, against a base rate of } 0.10\% — \textbf{10x}.$$

That edge is real and computable. It follows from the cap itself, by Corollary 1, and no
distribution scheme removes it. Three honest responses, in order of preference:

1. **Retire the tail.** Never sell the last slice; burn it or hold it back for a later
   event. Caps the observable edge at the retirement point.
2. **Delay the reveal.** Publish a chained commitment per pack in real time, reveal the
   full draw log at close. Binding immediately, transparent afterwards. Depletion still
   leaks through the secondary market, but slowly and noisily.
3. **Say it out loud.** The odds table is public either way. A late-box edge that everyone
   can compute is a feature of a provably capped supply, not a scandal.

## 7. Answers

**Can every card have a chance instead of minting all the boosters?** Yes for the chance,
no for the escape from the urn. §2 shows an urn already gives every card a strictly
positive chance in every pack while stock remains. §1 shows nothing else can hold a cap.

**Is the premine the only way to distribute it right?** No. The premine (scheme A) is one
implementation of the urn — the *eager* one — and it is the worst of the three that hold a
cap, because the order exists before anyone buys. Scheme C holds the same cap while making
the order unknowable to everyone, including us, until the block is mined.

**What actually needs changing** is not the cap and not the odds. It is that
`shop-data.js` currently ships the answer key.

## Appendix: reproducing the numbers

Working scripts are in the session scratchpad, not committed — they depend on the
reference-set crosswalk that `rules/research-sources.md` keeps out of this repository. The
binomial figures need only `n = 20993`, `p = 21/20997` and a stable log-space tail sum; the
urn figures are the hypergeometric identity in §2.
