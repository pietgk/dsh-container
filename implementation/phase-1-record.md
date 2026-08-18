# Phase 1 implementation record

Date: 2026-08-17

Status: PASS. Phase 1 is complete. The user accepted the Phase 2 runtime gate on 2026-08-17.

## Implemented foundation

- TypeScript 5.9 project with Node 24 ESM output and a `dsh-container` executable
- pnpm 11.7 lockfile and explicit `esbuild` install-script allowlist
- Nix flake development shell with pinned nixpkgs input
- runtime-validated metadata schema version 1
- deterministic instance and Apple resource naming
- managed workspace containment below the configured manager workspace root
- exact Apple Container command construction without a shell
- pinned image tag plus separately verified OCI index digest
- pinned custom-kernel path and SHA-256 verification
- Apple inspect-policy verification for read-only root, UID/GID, dropped capabilities, limits, and zero published ports or sockets
- manager-owned exec-stream loopback proxy with connection tracking, stdin-first cleanup, deadline, and child reaping
- atomic mode-0600 instance records
- append-only, mode-0600 partial-failure journal with secret redaction
- `doctor`, read-only `plan`, read-only `status`, and hidden managed-proxy CLI surfaces
- exact-target dry-run output and deletion command builders without `--all`, wildcards, or unresolved targets

## Verification

`pnpm check` passed:

- Biome lint: 28 files, no findings
- TypeScript strict typecheck: pass
- Node test runner through `tsx`: 18 tests, 18 passed
- production build: pass

Additional checks passed:

- `pnpm audit --prod`: no known vulnerabilities in the manager project
- built `node dist/cli.js doctor`: Apple CLI, API service, custom kernel digest, and accepted image digest all pass
- built `node dist/cli.js plan`: emits exact resources and commands and performs no mutation
- `nix flake check --no-build`: development shell evaluates
- `nix develop`: Node 24 and pnpm 11.7 are usable

## Deliberate Phase 2 boundary

The planner leaves `liveEgressAcknowledgedAt` and `bindRiskAcknowledgedAt` null. It does not infer these decisions from the architecture or dependency-audit approvals.

Before creating an actual managed instance, Phase 2 must require explicit acknowledgement that:

1. The guest has unrestricted outbound DNS and IP connectivity for providers, registries, packages, and development tools.
2. Code inside the guest can change or delete any file inside the exact writable bind workspace, although it cannot mount a parent directory or sibling workspace.

No Phase 1 command created, changed, stopped, or deleted an Apple Container resource.

The user subsequently acknowledged both runtime risks and authorized Phase 2 on 2026-08-17.
