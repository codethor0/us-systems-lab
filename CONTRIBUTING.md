# Contributing

This project is a small data file and a small, tested piece of arithmetic. Most contributions are
a new indicator (a node), a new relationship (an edge), or a correction to one of them. The rules
below exist so that a reader is never told more than the data supports.

Read [README.md](README.md) first. It explains the project and states that this is an illustrative
model, not a forecast.

## The hard rule: empirical and modeled edges

Every edge has a `confidence` of either `empirical` or `modeled`. This is not decoration, and it is
the one rule that no contribution may bend.

- **An edge is modeled by default.** Use `modeled` whenever you are unsure.
- **An edge may be `empirical` only if you attach a citation you have read yourself.** That means
  three fields, all required together:
  - `sourceUrl`: the https address of the page you read.
  - `sourceDetail`: which document, table or passage, and what it says, in a sentence.
  - `retrievedDate`: the day you read it, as `YYYY-MM-DD`.
- **The source must say the two indicators are related, and in which direction.** A page that
  mentions both indicators but does not say so does not count. A summary, a search result, an AI
  answer or memory does not count either. Open the page.
- **A citation supports that the relationship exists and its direction. It does not support a size.**
  The `strength` of every edge, empirical or modeled, is an editorial weight from four tiers:
  0.25, 0.5, 0.75, 1. Do not present it as a measured coefficient anywhere.
- **A modeled edge carries no source.** Leave `sourceUrl`, `sourceDetail` and `retrievedDate` as
  `null`. The validator rejects a modeled edge that has one.
- **Claims are one line and hedged.** Never use the words prove, proves or proven in a claim. A
  relationship that is argued about should say so.

If someone tells you a relationship is well established, then the way to make that count is a
citation. Until there is one, the edge stays modeled.

Some lines are absent on purpose. `hate_crimes` has no edges, and a test records that. An edge into
or out of it needs new evidence and a citation, not an argument.

## Relationship kind and horizon

Every edge also states what it asserts, independent of its `confidence`:

- `kind` is `accounting` when the link follows from how the measures are defined or added up,
  `causal` when it names a mechanism by which the first indicator moves the second, and
  `association` when the two move together and the edge does not say which causes which. Use
  `association` whenever the source, or the argument, shows co-movement only. A claim on an
  association edge must not use causal verbs such as causes, drives, raises or lowers.
- `horizon` is `short` (months), `medium` (a year or two) or `long` (several years).

Both labels are for readers. The arithmetic ignores them. A citation for an `empirical` edge must
support the kind it is labeled with: a table that shows co-movement supports `association`, not
`causal`.

## Dead ends

A node with no outgoing edge must say why in its `terminal` field, and a node that drives an edge
must leave `terminal` as `null`. The validator enforces both, so a dead end is always a recorded
decision. Do not add an edge only so that a tile moves; a stated dead end is better than an invented
link.

## Adding a node

A node is an indicator or a lever. Its fields are defined in `src/lib/schema.ts` and enforced by
`src/lib/validate.ts`.

| Field                                        | Rule                                                                                                                                         |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                         | Lowercase words joined by single underscores, unique.                                                                                        |
| `category`                                   | One of `economic`, `fiscal`, `social`, `institutional`, `policy`.                                                                            |
| `valueType`                                  | `observed` is a measured series. `projected` is a forecast, never shown as an observation. `index` is an abstract 0 to 100 lever.            |
| `baseline`                                   | A number, or `null`. An `index` node must be `null`.                                                                                         |
| `range`                                      | An editorial display scale that comfortably holds the baseline. It is not data. Explain your choice in the pull request.                     |
| `asOf`                                       | The period the baseline describes: `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, `YYYY-Qn` or `FYYYYY`. Required when there is a baseline.                |
| `verification`                               | `primary`, `secondary` or `pending` for observed and projected nodes. `null` for an `index` node.                                            |
| `sourceUrl`, `sourceDetail`, `retrievedDate` | Required for `primary` and `secondary`. For `pending`, `sourceUrl` and `retrievedDate` must be `null`.                                       |
| `cadence`                                    | How often the publisher releases a new figure: `daily`, `weekly`, `monthly`, `quarterly`, `annual` or `irregular`. `null` for `index` nodes. |
| `terminal`                                   | Why nothing is modeled downstream, required exactly when no edge leaves the node. Otherwise `null`.                                          |

How to verify a starting value:

- **`primary`** means you opened the page at the publisher of the figure and found the number on it.
  The host must be on the allowlist in `src/lib/validate.ts`. Adding a host is a maintainer
  decision, so justify it in the pull request: it must be the publisher of the figure itself, not a
  site that relays it.
- **`secondary`** means a news page or aggregator relays a figure you could not read at the
  publisher.
- **`pending`** means you have a value but have not read a source page. Say where you found it in
  `sourceDetail`.
- Quote the figure as the page states it, with the release date, in `sourceDetail`. Note revisions,
  projections and definitions that a reader would otherwise miss.
- Do not store a derived number, such as a growth rate you computed from two readings, as though it
  had been fetched. `debt_growth_rate` is empty for that reason.

## Refreshing a baseline

`npm run check:freshness` lists the baselines that may have a newer release, judged from each
node's `cadence` and the end of its period. It reads no network and does not fail. The weekly CI run
writes the same table to its job summary. A flag is a prompt to read the source, not a finding that
the value is wrong, and a date that looks current does not catch a revision to the same period.

To refresh a node, open the publisher's page, read the new figure, and update `baseline`, `asOf`,
`sourceUrl`, `sourceDetail` and `retrievedDate` together in one change, with the release date and
any revision noted in `sourceDetail`. Update the matching row of the table in README.md. Never
change the value alone, and never take it from a search result or summary.

## Adding an edge

- `id` is `from__to`, using the two node ids, and both nodes must exist. No self loops, and no two
  edges with the same id.
- `direction` is `1` or `-1`. `strength` is one of 0.25, 0.5, 0.75, 1. `confidence` follows the hard
  rule above. `kind` and `horizon` follow the section on relationship kind and horizon.
- **Edges are locked by tests, on purpose.** `src/data/graph.test.ts` lists the accepted edge ids,
  and `src/lib/propagation.test.ts` contains hand-computed expectations for the real graph. Adding,
  removing or reweighting an edge changes them. Update the list, redo the arithmetic by hand in the
  test comments, and show your working in the pull request. Do not change an expected number to
  match the output.

## Before you open a pull request

- Commits on this repository are made by the maintainer only. `npm run check:attribution` fails
  any commit whose author is not listed in `.github/allowed-authors`, and any co-author trailer or
  tool credit in a commit message or pull request description. To propose a change, open an issue
  or a pull request with the change described; if it is accepted, the maintainer commits it.
- Run `npm run verify` and `npm run test:e2e`. [TESTING.md](TESTING.md) lists what each one
  checks. Continuous integration runs the same checks and also audits dependencies.
- For a change to logic, write the test first and watch it fail. In `src/lib`, every branch must be
  covered by a test that can fail, so do not add a test that only exercises code.
- Keep to one topic per pull request. Say what you read, and when.
- Write commit messages in the Conventional Commits style: `feat:`, `fix:`, `docs:` or `chore:`.
- **No emoji anywhere**: not in code, comments, commit messages, documents or interface text.
  `npm run check:emoji` finds them.
- **Signed commits.** The `main` branch requires signed commits, and an unsigned commit on a pull
  request branch can block a squash merge. See
  [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
  This is one reason the maintainer makes the final commit.

## Reporting a problem with the data

Open an issue with the node or edge id, what you believe is wrong, and the page that shows it. A
source that contradicts a stored value is the most useful report there is.

## License

By contributing, you agree that your contributions are licensed under the [MIT license](LICENSE) of
this repository.
