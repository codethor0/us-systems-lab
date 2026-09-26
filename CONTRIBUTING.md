# Contributing

Thank you for helping. This project is a small, careful piece of data plus a small, carefully
tested piece of arithmetic. Most contributions are either a new indicator (a node), a new
relationship (an edge), or a correction to one of them. The rules below exist because the whole
value of the project is that a reader is never told more than the data supports.

Read [README.md](README.md) first. It explains the project, and it states plainly that this is an
illustrative model and not a forecast.

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

## Adding a node

A node is an indicator or a lever. Its fields are defined in `src/lib/schema.ts` and enforced by
`src/lib/validate.ts`.

| Field                                        | Rule                                                                                                                              |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `id`                                         | Lowercase words joined by single underscores, unique.                                                                             |
| `category`                                   | One of `economic`, `fiscal`, `social`, `institutional`, `policy`.                                                                 |
| `valueType`                                  | `observed` is a measured series. `projected` is a forecast, never shown as an observation. `index` is an abstract 0 to 100 lever. |
| `baseline`                                   | A number, or `null`. An `index` node must be `null`.                                                                              |
| `range`                                      | An editorial display scale that comfortably holds the baseline. It is not data. Explain your choice in the pull request.          |
| `asOf`                                       | The period the baseline describes: `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, `YYYY-Qn` or `FYYYYY`. Required when there is a baseline.     |
| `verification`                               | `primary`, `secondary` or `pending` for observed and projected nodes. `null` for an `index` node.                                 |
| `sourceUrl`, `sourceDetail`, `retrievedDate` | Required for `primary` and `secondary`. For `pending`, `sourceUrl` and `retrievedDate` must be `null`.                            |

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

## Adding an edge

- `id` is `from__to`, using the two node ids, and both nodes must exist. No self loops, and no two
  edges with the same id.
- `direction` is `1` or `-1`. `strength` is one of 0.25, 0.5, 0.75, 1. `confidence` follows the hard
  rule above.
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
- Run `npm run verify`. It runs lint, type check, format check, the tests with a 100 percent
  coverage threshold for `src/lib`, the script tests, and the emoji check. Continuous integration
  runs the same checks and also audits dependencies.
- For a change to logic, write the test first and watch it fail. In `src/lib`, every branch must be
  covered by a test that can fail, so do not add a test that only exercises code.
- Keep to one topic per pull request. Say what you read, and when.
- Write commit messages in the Conventional Commits style: `feat:`, `fix:`, `docs:` or `chore:`.
- **No emoji anywhere**: not in code, comments, commit messages, documents or interface text.
  `npm run check:emoji` finds them.
- **Signed commits.** The `main` branch requires signed commits. GitHub also checks the commits on
  your pull request branch, and its documentation says an unsigned commit there can block a squash
  merge even though GitHub signs the final commit. See
  [About protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches).
  Sign your commits, or tell a maintainer if you cannot.

## Reporting a problem with the data

Open an issue with the node or edge id, what you believe is wrong, and the page that shows it. A
source that contradicts a stored value is the most useful report there is.

## License

By contributing, you agree that your contributions are licensed under the [MIT license](LICENSE) of
this repository.
