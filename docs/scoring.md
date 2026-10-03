# Scoring and move-label rules

Chess Workbench reports engine-based estimates. The labels are this site's
heuristics, not official classifications, and they can change with search
depth, engine version, and the visitor's hardware.

## Analysis defaults

The depth selector offers three Stockfish search depths:

| Selector | UCI command | Meaning |
| --- | --- | --- |
| Quick | `go depth 8` | Search to depth 8 |
| Balanced (default) | `go depth 12` | Search to depth 12 |
| Deep | `go depth 16` | Search to depth 16 |

The selected value is passed directly as UCI `go depth`; it is not a time,
node, or strength setting. The default is the selected **Balanced** option at
depth 12. Every position is analyzed in order, starting with the initial
position and including the position after every half move. A terminal position
is handled locally and is not sent to the engine.

The worker starts Stockfish with a 16 MB hash and these options:

```text
setoption name Hash value 16
setoption name MultiPV value 2
setoption name UCI_ShowWDL value true
```

For each non-terminal position it requests two principal variations (PV) with
`go depth <selected depth>`. It keeps the most recent eligible `info` result
for each PV rank at the deepest depth reported so far. An `info` line must
contain a score and a PV; lower-bound and upper-bound scores are ignored. The
result's `bestMove` comes from the engine's `bestmove` response. PV rank 1 is
the preferred line and rank 2 is the alternative used by the Great test. Rank
2 may be unavailable, in which case a move cannot qualify as Great.

## Score orientation and display

Stockfish scores and WDL values are interpreted from the side-to-move's
perspective. The UI converts the score to White's perspective before display:

```text
white score = engine score                 if White is to move
              -engine score                if Black is to move
```

Centipawn scores are displayed as pawns with two decimal places (`+1.25`,
`−0.83`). A forced mate keeps its UCI `mate` value and is displayed as `+M3`
or `−M3`; the magnitude is not converted to pawns. The graph maps a mate to a
fixed ±8-pawn position for plotting only. A positive White-perspective score
favors White and a negative score favors Black.

Terminal positions use synthetic results instead of a search. Checkmate is a
`mate -1` score for the side to move, with WDL `[0, 0, 1000]`; other game-over
positions (for example, a draw) use a zero score with WDL `[0, 1000, 0]`.

## Expected score

`expectedForSide(info)` returns a number from the side-to-move perspective:

1. Missing engine data returns `0.5`.
2. A positive mate score returns `1`; a negative mate score returns `0`.
   Mate distance is intentionally ignored.
3. When WDL is present, it is interpreted as Stockfish's permille
   `[win, draw, loss]` estimate:

   ```text
   expected = (win + draw / 2) / 1000
   ```

4. Otherwise, a centipawn score uses this logistic conversion:

   ```text
   expected = 1 / (1 + exp(-centipawns / 140))
   ```

The WDL value takes precedence over the centipawn value. The expected score
is a probability-like game result estimate: a win counts as 1, a draw as 0.5,
and a loss as 0. It is not a rating or a claim about the game's actual result.

## Expected score lost on a move

For a move by the player whose turn it is:

```text
before = expectedForSide(before position, PV 1)
after  = 1 - expectedForSide(after position, PV 1)
loss   = clamp(before - after, 0, 1)
```

The subtraction by one is required because the after-position is evaluated
from the opponent's side-to-move perspective. The displayed loss is
`loss * 100` percentage points. For example, `0.12` means an estimated 12.0
percentage points of expected score were lost. A move's loss is never
negative, even when the after-position appears better for the mover.

The move's UCI encoding must exactly match the engine's `bestmove` from the
before-position to count as Best. If either position lacks PV 1, no label is
returned for that move.

## Label decision order and thresholds

Rules are evaluated in the order below. Earlier rules win when more than one
condition applies. Unless a boundary is explicitly included, the comparisons
are strict.

| Label | Exact condition |
| --- | --- |
| **Brilliant** | The move is Best **or** `loss < 0.02`, and it passes the sound-sacrifice test below. |
| **Great** | The move is Best, PV 2 exists, `before - secondExpected >= 0.10`, and `before >= 0.40`. |
| **Best** | The move's UCI encoding exactly equals PV 1's `bestmove`. |
| **Miss** | Not already labeled above; `before >= 0.75`, `after < 0.65`, and `loss >= 0.12`. |
| **Excellent** | `loss < 0.025`. |
| **Good** | `0.025 <= loss < 0.06`. |
| **Inaccuracy** | `0.06 <= loss < 0.12`. |
| **Mistake** | `0.12 <= loss < 0.22`. |
| **Blunder** | `loss >= 0.22`. |

The Great comparison uses PV 2 from the same before-position, so
`secondExpected` is `expectedForSide(before position, PV 2)`. It measures how
much worse the second engine choice is than the position's expected score;
the move must also be the engine's PV 1 choice.

### Sound-sacrifice test for Brilliant

The move must satisfy all of these conditions:

- it moves a knight, bishop, rook, or queen (not a pawn or king);
- `before < 0.90` and `after >= 0.43`;
- the opponent's PV 1 exists and its destination square is the square the
  move just used;
- applying that reply legally captures a piece; and
- the moving piece's point value minus the value of the piece it initially
  captured is at least 2.

Piece values for this test are pawn 1, knight 3, bishop 3, rook 5, queen 9,
and king 0. Thus a bishop offering itself after capturing a pawn meets the
material threshold (`3 - 1 = 2`) when the engine also considers the move
sound. A Brilliant move is checked before Great, so a sound sacrifice that is
also a unique Best move is labeled Brilliant.

## Game summary

The summary counts only moves that received a label. It keeps White and Black
separate, sums each side's clamped loss values, and reports:

```text
average expected score lost = sum of that side's losses / reviewed moves
```

The summary percentage is therefore depth-dependent and should not be read as
an Elo, accuracy certification, or standalone assessment of a player.
