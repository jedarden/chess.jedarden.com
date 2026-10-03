# Game input and PGN format

Chess Workbench accepts one chess game at a time. Paste the game into the
notation box, or choose a text file, then press **Analyze game**. Parsing and
engine analysis stay in the browser; the notation is not sent to a server.

The parser uses the `chess.js` PGN reader. Move text should use standard
algebraic notation (SAN), and every move must be legal in the position reached
so far.

## Numbered move text

Numbered move text can be pasted without PGN tags. Move numbers, whitespace,
and line breaks are flexible; the parser also accepts text without move
numbers, but numbered notation is easier to read and share.

```text
1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 *
```

Use SAN for ordinary moves, captures, promotions, check, checkmate, and
castling:

```text
1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 5. O-O
```

The move list is replayed in order. A move number or result marker is not
counted as a move.

## PGN tags

PGN tag pairs go before the move text, one per line, with a quoted value:

```text
[Event "Casual game"]
[Site "Home"]
[Date "2026.10.03"]
[Round "1"]
[White "Alice"]
[Black "Bob"]
[Result "1-0"]

1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0
```

`White` and `Black` become the player names shown around the board. If they
are absent (or are `?`), the site uses **White** and **Black**. `Result` is
used for the final game detail when it is not `*`; other tags are accepted as
PGN metadata but are not displayed by the review.

For a game that starts from a position other than the normal initial board,
include the standard `SetUp` and `FEN` tags:

```text
[SetUp "1"]
[FEN "4k3/8/8/8/8/8/8/4K2R w - - 0 1"]
[White "Alice"]
[Black "Bob"]

1. Rh2 *
```

## Comments and variations

Brace comments and semicolon comments are accepted and ignored during replay.
A semicolon comment continues to the end of its line.

```text
1. e4 {The king's pawn} e5 ; Black answers in kind
2. Nf3 Nc6
```

Parenthesized variations, including nested variations, are also accepted and
ignored. Only the main line outside parentheses is analyzed:

```text
1. e4 (1. d4 d5 2. c4) e5 2. Nf3
```

This replays `e4`, `e5`, and `Nf3`; it does not create a second branch in the
review.

## Results

The PGN result markers `1-0`, `0-1`, `1/2-1/2`, and `*` are accepted at the
end of the move text. `*` is appropriate for an unfinished game. A result
marker ends the game and is not replayed as a move. For the result to appear
in the review's final detail, put the same value in the `[Result "..."]` tag.

## Uploads

The **Upload .pgn** control accepts `.pgn` and `.txt` files (plain text). It
reads the first selected file into the notation box; it does not analyze the
file automatically. Press **Analyze game** to parse and review it. An upload
uses the same rules and error handling as pasted text, regardless of the
filename.

## Empty or invalid input

Parsing happens when **Analyze game** is pressed, not merely when text is
pasted or a file is selected.

- Blank text or a blank file shows: `Paste a game or choose a PGN file first.`
- Tags, a result marker, or other input with no moves shows: `No moves were
  found in the notation.`
- An illegal move, malformed tag, or malformed PGN shows `The notation could
  not be read: ...` with the parser's explanation.
- A failed parse does not partially replay the input. The current review stays
  in place, and the error is shown below the Analyze button.

For example, this is rejected because `NotAMove` is not a legal move in that
position:

```text
1. e4 e5 2. NotAMove
```
