# Contributing

`dsh-container` is an Apple-silicon macOS evaluation tool. Keep changes narrow,
fail closed when a security control is unavailable, and preserve the exact
resource-ownership boundaries recorded in the accepted specification.

## Local checks

```text
nix develop
pnpm install --frozen-lockfile
pnpm check
nix flake check --no-build
nix build .#dsh-container
```

Run the visual suite only against a controlled local evaluation instance:

```text
pnpm exec playwright install chromium
DSH_E2E_BASE_URL=http://127.0.0.1:30081 pnpm e2e
```

Apple Container lifecycle tests require an Apple-silicon Mac with the exact
reviewed runtime. GitHub-hosted runners cannot exercise the nested VM lifecycle.
Never place provider credentials, instance state, or evaluation workspaces in
the repository.
