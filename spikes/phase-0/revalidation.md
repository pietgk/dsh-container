# Phase 0 revalidation record

Date: 2026-08-17

Status: complete and accepted; Phase 1 authorized on 2026-08-17.

Architecture verdict: the immutable image and runtime-security spike passed. The original Apple Unix-socket Web transport failed. The user accepted the passing exec-stream replacement and mandatory pinned custom kernel. The user also acknowledged the image audit risk for evaluation.

## Gate status

| Gate | Status | Evidence or remaining decision |
| --- | --- | --- |
| Host and toolchain | Pass | Apple Silicon `arm64`; macOS 26.5.1 (25F80); Node 24.18.0; pnpm 11.7.0; Zed 1.15.0. |
| Nix-friendly Apple install | Pass | Homebrew formula `container` is declared in the user's nix-darwin configuration and installed as Apple Container 1.2.2. `nix flake check --no-build`, the Darwin configuration build, and the managed rebuild passed. |
| Existing runtime isolation | Pass | Apple Container 1.2.2 is running. Colima 0.10.3 `default` is stopped and untouched. Its config SHA-256 remains `e0b10c055c0d63243a7289bb0524498390f5ba5195e6549ad0de38d4cd5c0d8c`. |
| Immutable DSH selection | Pass | Official remote; SHA `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`; tag `dsh-v0.1.0-rc.7`; version `0.1.0-rc.7`; clean checkout and matching official tag. |
| Build entry points | Pass | Frozen pnpm install, host/client TypeScript, `tsdown`, Vite Web frontend, and static-musl Linux arm64 launcher all built. |
| DSH launch and credentials | Pass | DSH launches from empty `/state/launch`; `/workspace` is registered through the Web API; workspace `.env` is not inherited; provider settings remain inside per-instance DSH state. |
| Apple resource controls | Pass | Non-root, read-only rootfs, all capabilities dropped, exact writable mounts, CPU and memory bounds, `nproc`, `nofile`, and dedicated network were functionally exercised. |
| Landlock | Pass with mandatory custom kernel | Apple's default kernel has Landlock disabled. The pinned custom Linux 6.18.5 kernel enforced the denial probe. Kernel SHA-256 `5ac12b28ec01f5ed89f4a6397a29a422b3e615f2b382d8ec328991b1a3953d1b`. |
| Dependency audit | Accepted for evaluation | 437 production dependencies: 0 critical, 12 high, 12 moderate, 1 low. Explicitly acknowledged by the user on 2026-08-17. |
| Spike B: immutable image | Technical pass | OCI index `sha256:a9f384b239d75d6aca3448a7bb4ead0d6697fb9271e4b46b78849254dd4afc39`; full build, confinement, writable-path, session, persistence, and shutdown proofs passed. |
| Spike A original: Apple published socket | Fail | Apple relay cannot see tmpfs or volume sockets through its immutable rootfs view. Host connections reset. Making rootfs writable is rejected. |
| Spike A amended: exec-stream proxy | Accepted | Full frontend, HTTP/API, WebSocket, Host fence, loopback-only listeners, direct IPv4/IPv6 denial, persistence, and clean stop passed without published ports or sockets. The one-exec-child-per-connection cost and required Phase 2 tests were accepted on 2026-08-17. |

## Launch-directory and credential decision

DSH snapshots environment values from the invocation directory and `DSH_HOME`. Launching from `/workspace` would therefore allow a bound project's `.env` to enter DSH's provider and subprocess environment.

The accepted runtime shape is:

1. Start DSH from empty `/state/launch`.
2. Set `DSH_HOME` under `/state` and keep `$DSH_HOME/.env` absent.
3. Pass only manager-owned, non-secret environment values.
4. Register and select `/workspace` through DSH's Web API.
5. Create sessions with immutable cwd `/workspace`, which Landlock uses as its writable root.
6. Configure provider credentials through DSH Web settings into per-instance state.
7. Test that a sentinel in `/workspace/.env` never reaches DSH or a tool subprocess.

The remote-browser directory picker can browse the guest filesystem and is not a security boundary. Version 1 supports only `/workspace` even if DSH can display other paths.

## Phase 1 entry decisions

The user explicitly confirmed both on 2026-08-17:

1. Accept and proceed with the exec-stream Web transport and pinned custom Landlock kernel, including the required lifecycle and load tests.
2. Acknowledge 12 high and 12 moderate production dependency findings for the DSH `0.1.0-rc.7` evaluation image.

Phase 1 is authorized. The accepted limits remain binding: do not make the rootfs writable and do not expose DSH on a guest network interface.
