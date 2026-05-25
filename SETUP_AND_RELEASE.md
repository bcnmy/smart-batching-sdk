# smart-batching

## Installation

```bash
bun install
```

## Development

```bash
bun run index.ts
```

### Linting & Formatting

This project uses [Biome](https://biomejs.dev) for linting and formatting.

```bash
bun run check      # lint + format (recommended)
bun run lint       # lint only, auto-fix
bun run format     # format only, auto-fix
```

---

## Release Flow

Releases are managed with [Changesets](https://github.com/changesets/changesets). Every change that should be released must have an accompanying changeset describing the impact.

### 1. Create a changeset

After making your changes, run:

```bash
bunx changeset
```

This prompts you to:
- Select the bump type — `patch` (bug fix), `minor` (new feature), or `major` (breaking change)
- Write a short summary of the change

A `.changeset/*.md` file is created and should be committed alongside your code changes.

### 2. Bump versions

Once changesets are merged to `main`, consume them to update `package.json` versions and generate the `CHANGELOG.md`:

```bash
bun run version
```

Commit the resulting changes:

```bash
git add .
git commit -m "chore: version packages"
```

### 3. Publish to npm

```bash
bun run release
```

This runs `changeset publish`, which:
- Publishes any packages whose version has not yet been published to npm
- Creates git tags for each published version

Push the tags:

```bash
git push --follow-tags
```

---

### Bump type reference

| Type | When to use |
|---|---|
| `patch` | Bug fixes, internal refactors with no API change |
| `minor` | New features, backwards-compatible additions |
| `major` | Breaking changes to the public API |

### Pre-release (canary)

To publish a canary build for testing without affecting the stable release:

```bash
bunx changeset pre enter canary
bun run version
bun run release --tag canary
bunx changeset pre exit
```
