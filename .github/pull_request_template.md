## Summary

Describe the problem and the smallest change that addresses it.

## Validation

- [ ] `npm run verify` passes.
- [ ] `npm run test:e2e` passes for UI, model, runtime, URL, layout, or deployment changes.
- [ ] `npm audit --audit-level=low` has been reviewed when dependencies changed.
- [ ] No secrets, credentials, private logs, local machine paths, or generated build output are included.
- [ ] The pull request contains no unrelated changes.

## Data or model changes

- [ ] Source/provenance metadata is updated when facts or baselines change.
- [ ] Observed and projected values remain explicitly distinguished.
- [ ] Every changed causal relationship is explicitly classified as modeled or empirical.
- [ ] Claims do not present a modeled relationship as a measured causal estimate.

If this pull request does not change data or the causal model, state `Not applicable`.

## Security

Describe any security-relevant behavior changed by this pull request. For an undisclosed vulnerability, stop and use the private process in `SECURITY.md` instead of publishing details here.
