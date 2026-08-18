# dsh-container

`dsh-container` is a narrow TypeScript manager for reproducible DeepSeek Harness
(DSH) evaluation instances on Apple Container. Version 1 supports one backend,
bind workspaces, a pinned Landlock-capable kernel, and explicitly acknowledged
live outbound networking.

The manager provides:

- versioned, runtime-validated instance metadata
- deterministic Apple Container resource ownership
- non-root execution, read-only rootfs, dropped capabilities, and resource limits
- an exact verified custom kernel with a functional Landlock probe
- a manager-owned Mac loopback proxy with bounded exec-stream admission
- resumable initialization and idempotent lifecycle commands
- append-only failure records, secret redaction, and dry-run reporting
- Nix package, app, and development shell outputs for Apple silicon

## Install and run with Nix

```text
nix run github:pietgk/dsh-container -- doctor
nix run github:pietgk/dsh-container -- plan --name demo --workspace ./workspaces/demo
```

The pinned custom kernel is downloaded as a fixed-output GitHub release asset
and verified by both Nix and the manager. Apple Container itself remains a host
prerequisite and is intentionally not installed by this flake.

For a nix-darwin or Home Manager configuration:

```nix
inputs.dshContainer = {
  url = "github:pietgk/dsh-container";
  inputs.nixpkgs.follows = "nixpkgs";
};
```

## Development

```text
nix develop
pnpm install --frozen-lockfile
pnpm check
nix flake check --no-build
nix build .#dsh-container
```

The source-tree `doctor` expects the verified kernel at
`spikes/phase-0/apple-kernel/vmlinux-arm64`. Normal users should run the Nix
package, which acquires the pinned artifact automatically.

## Evaluation posture

The accepted `evaluation` vertical slice uses unrestricted guest egress and a
writable bind workspace. These risks were explicitly acknowledged for the
controlled evaluation. The Web UI is exposed only through a manager-owned
proxy on Mac loopback; the DSH process stays on guest loopback and the container
publishes no ports or sockets.

This is not a multi-user security boundary. Use a disposable, scope-limited
provider key and rotate it after risky work.

- [Accepted implementation specification](dsh-container-plan.md)
- [Phase 3 evaluation record](implementation/phase-3-record.md)
- [Evidence policy](docs/evaluation/evidence-policy.md)
- [Browser and Playwright runbook](docs/evaluation/browser-runbook.md)
- [Open gap register](docs/evaluation/gap-register.md)
- [Architecture review artifacts](docs/architecture/README.md)

## Visual evaluation

See [Browser and Playwright runbook](docs/evaluation/browser-runbook.md).

## License

MIT
