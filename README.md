# US Systems Lab

An interactive causal graph of U.S. economic and social indicators. Move a lever on one indicator
and see which connected indicators shift, in which direction, and roughly how much.

> **Read this first.** This is an illustrative model for exploring how systems connect. It is not
> a predictive economic tool and not a forecast. The numbers it propagates are arithmetic on
> hand-assigned weights, not estimates of what would happen if a real policy or event moved a real
> indicator.

## Status

Early. Built and tested: the data model and its validator, a graph with cited starting values, the
propagation logic, the repository's automated checks, and the first browser interface with the graph,
lever controls, and scenario-link loading. Browser-level visual and accessibility regression checks
are not built yet, and deployment is not built. [DEPLOYMENT.md](DEPLOYMENT.md) records the deployment
plan.

## How to read the labels: empirical and modeled

Every arrow in the graph says that one indicator affects another. Each arrow carries one of two
labels, and the difference between them is the most important thing in this project.

- **Empirical** means a specific, cited source supports that the relationship exists and points in
  that direction. The citation travels with the arrow: a link, a description of the document, and
  the date it was read. Even then, the weight drawn on the arrow is one of four coarse tiers, not a
  measured coefficient. The citation backs the direction, not the size.
- **Modeled** means the direction is commonly argued and plausible, but the relationship is
  contested or has no size that anyone can cite. A modeled arrow carries no source, and the
  interface will not present it as a finding.

An arrow is modeled unless someone supplies a checkable citation. Nothing is promoted because
"everyone knows".

The starting value of each indicator has its own, separate label. `primary` means a page at the
primary publisher was read on a stated date and the figure was found on it. `secondary` means a news
page or aggregator relays the figure. `pending` means a value was supplied but no source page has
been read yet. Abstract levers, such as worker bargaining power, sit on an index from 0 to 100 and
have no baseline at all, because there is nothing measured to check.

The graph currently has 20 nodes and 20 edges: 0 empirical and 20 modeled. Every arrow is therefore
an argument today, and none is yet a finding.

## How the arithmetic works

Moving a lever sets a number between -1 and 1, meaning a fraction of an editorial display range for
that indicator. [src/lib/propagation.ts](src/lib/propagation.ts) then walks every path of up to
three arrows from that indicator. Each arrow multiplies the change by its direction (+1 or -1) and
its strength, and every arrow after the first shrinks the change by a decay factor (0.7 by default,
a starting point with no empirical basis). Effects that arrive by different routes add, and the
total for each indicator is clamped to the range -1 to 1.

That is all. It is arithmetic, not estimates, and it knows nothing about the economy. The header of
that file states what it does and does not show, including short arguments that its output is
bounded, that it always terminates, and that it is deterministic.

## Data and sources

The data lives in [src/data/graph.json](src/data/graph.json), and
[a validator](src/lib/validate.ts) checks every change to it. The nodes and levers follow two posts
by the project's author that map U.S. indicators and policy levers. The 20 edges are editorial
drafts, reviewed and accepted by the author. They are not taken from those posts, and none has a
citation yet.

Each starting value below was read from the linked page on 2026-09-19. The `sourceDetail` field of
each node records the caveats, such as figures that are revised later, and one that is a projection
and not an observation.

| Indicator                        | Value                            | Period      | Source                                                                                                                                                                                                      |
| -------------------------------- | -------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Inflation                        | 3.4% year over year              | Aug 2026    | [BLS, Consumer Price Index release](https://www.bls.gov/news.release/archives/cpi_09112026.htm)                                                                                                             |
| Federal funds rate               | 3.75% to 4.00% target range      | 16 Sep 2026 | [Federal Reserve, FOMC statement](https://www.federalreserve.gov/newsevents/pressreleases/monetary20260916a.htm)                                                                                            |
| 30-year mortgage rate            | 6.95%                            | 17 Sep 2026 | [Freddie Mac, Primary Mortgage Market Survey](https://www.freddiemac.com/pmms)                                                                                                                              |
| Real GDP growth                  | 1.5% annualized, second estimate | Q2 2026     | [BEA, GDP second estimate](https://www.bea.gov/news/2026/gdp-second-estimate-and-corporate-profits-2nd-quarter-2026)                                                                                        |
| Monthly payroll change           | +162,000 jobs                    | Aug 2026    | [BLS, Employment Situation](https://www.bls.gov/news.release/archives/empsit_09042026.htm)                                                                                                                  |
| Real hourly earnings             | -0.3% year over year             | Aug 2026    | [BLS, Real Earnings](https://www.bls.gov/news.release/archives/realer_09112026.htm)                                                                                                                         |
| Household debt                   | $18.8 trillion                   | Q2 2026     | [New York Fed, Household Debt and Credit](https://www.newyorkfed.org/newsevents/news/research/2026/20260811)                                                                                                |
| Personal saving rate             | 3.0% of disposable income        | Jul 2026    | [BEA, Personal Income and Outlays](https://www.bea.gov/news/2026/personal-income-and-outlays-july-2026)                                                                                                     |
| Federal debt                     | $40.05 trillion                  | 18 Aug 2026 | [U.S. Treasury, Debt to the Penny](https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?filter=record_date:eq:2026-08-18&fields=record_date,tot_pub_debt_out_amt) |
| Net interest outlays             | 3.3% of GDP, a projection        | FY2026      | [CBO, Budget and Economic Outlook](https://www.cbo.gov/publication/61882)                                                                                                                                   |
| Labor productivity               | +2.2% year over year             | Q2 2026     | [BLS, Productivity and Costs](https://www.bls.gov/news.release/archives/prod2_09032026.htm)                                                                                                                 |
| Median household income          | $87,460                          | 2025        | [Census Bureau, Income in the United States: 2025](https://www.census.gov/library/publications/2026/demo/p60-289.html)                                                                                      |
| Official poverty rate            | 10.2%                            | 2025        | [Census Bureau, Poverty in the United States: 2025](https://www.census.gov/library/publications/2026/demo/p60-290.html)                                                                                     |
| Food insecurity                  | 13.7% of households              | 2024        | [USDA ERS, Household Food Security 2024](https://www.ers.usda.gov/publications/pub-details?pubid=113622)                                                                                                    |
| People experiencing homelessness | 745,652 people on one night      | Jan 2025    | [HUD, 2025 homelessness report release](https://www.hud.gov/news/hud-no-26-037)                                                                                                                             |
| Confidence in institutions       | 27%, 14-institution average      | 2026        | [Gallup, Confidence in Institutions](https://news.gallup.com/poll/712436/confidence-institutions-remains-near-time-low.aspx)                                                                                |
| Trust in media                   | 28%                              | Sep 2025    | [Gallup, Trust in Media](https://news.gallup.com/poll/695762/trust-media-new-low.aspx)                                                                                                                      |
| Reported hate crimes             | 10,606 reported incidents        | 2025        | [FBI, 2025 Reported Crimes in the Nation](https://www.fbi.gov/news/press-releases/fbi-releases-2025-reported-crimes-in-the-nation-statistics)                                                               |

Two nodes have no baseline. `worker_bargaining_power` is an abstract 0-to-100 lever.
`debt_growth_rate` is a rate that would be derived from two Treasury readings a year apart, and a
derived number is computed where it is shown and not stored as though it had been fetched.

## Getting started

Requirements: Node 24 (see `.nvmrc`) and Python 3, which the repository's checks use.

```bash
npm ci
npm run verify
npm run dev
```

`npm run verify` runs the same checks as continuous integration: lint, type check, format check,
tests with a 100 percent coverage threshold for the core model plus the pure UI helpers, a production
build, the script tests, and the emoji check. Continuous integration also audits dependencies. Use
`npm run dev` for the local Vite server, `npm run build` for the static production bundle, and
`npm run preview` to serve that bundle locally.

## Contributing, license and deployment

- [CONTRIBUTING.md](CONTRIBUTING.md) explains the data model and the rule for adding an indicator
  or an arrow, including the requirement to keep empirical and modeled apart.
- [LICENSE](LICENSE) is the MIT license.
- [DEPLOYMENT.md](DEPLOYMENT.md) records the hosting decision and the manual steps.
