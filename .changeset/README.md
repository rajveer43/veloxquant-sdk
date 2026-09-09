# Changesets

This directory holds changeset files used by [@changesets/cli](https://github.com/changesets/changesets) to
version packages and generate release notes.

When you open a PR with a user-facing change (new feature, bug fix, breaking change), run:

```sh
npx changeset
```

This walks you through selecting a bump type (patch/minor/major) and writing a short summary. Commit the
generated `.changeset/*.md` file with your PR — it becomes the changelog entry for that change.

On merge to `master`, a GitHub Action opens/updates a "Version Packages" PR that consumes pending changesets,
bumps `package.json`, and writes `CHANGELOG.md`. Merging that PR publishes the release and creates a GitHub
Release with the generated notes automatically.

See https://github.com/changesets/changesets/tree/main/docs for full docs.
