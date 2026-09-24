# Fit engine

Each rule returns `PASS`, `VERIFY`, `FAIL`, or `NOT_APPLICABLE` plus measured/required values,
margin, uncertainty, explanation, and geometry references.

Aggregation is deterministic:

1. Any critical `FAIL` makes the result `FAIL`.
2. Otherwise any critical `VERIFY` makes the result `VERIFY`.
3. Otherwise all critical checks passing makes the result `FIT`.

## Conservative uncertainty

A measurement `x ± u` represents `[x-u, x+u]`. For an allowed installation range:

- the complete measured interval inside the allowed range is `PASS`;
- partial overlap is `VERIFY` because a manual measurement could change the answer;
- no overlap is `FAIL`.

For spatial checks, nominal collision is `FAIL`. If nominal geometry is clear but the uncertainty-
expanded geometry collides, the check is `VERIFY`. A definitive `FIT` must survive the complete
relevant uncertainty envelope.

No opaque AI confidence percentage is calculated. `confidence` is deliberately absent; the result
exposes verification and uncertainty evidence directly.

