# Phase 2 Apple vertical-slice record

Dates: 2026-08-17 through 2026-08-18

Status: PASS for the named bind-mode vertical slice. The managed `evaluation`
instance is running and ready at `http://127.0.0.1:30081/`.

## Accepted runtime posture

The user explicitly acknowledged and accepted these evaluation risks before
resource creation:

- unrestricted guest DNS and IP egress
- modification or deletion of data inside the exact bind workspace

The accepted DSH dependency audit remains 0 critical, 12 high, 12 moderate,
and 1 low finding across 437 production dependencies. The acceptance is
revision-specific and evaluation-only.

## Managed instance

- name: `evaluation`
- ID: `bc4bfb958444a8030c039b838af467d0`
- DSH: `0.1.0-rc.7` at `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`
- container: deterministic manager-owned `evaluation` container
- network: deterministic manager-owned `evaluation` network
- state volume: deterministic manager-owned `evaluation` state volume
- cache volume: deterministic manager-owned `evaluation` cache volume
- workspace: `$DSH_CONTAINER_WORKSPACE_ROOT/evaluation`
- public URL: `http://127.0.0.1:30081/`
- transport: one owned interactive `container exec` byte stream per TCP connection

## Implemented lifecycle

- `init` creates and journals only the exact network and two volumes, resumes
  partial initialization, sets volume ownership with a short-lived root
  initializer, and records both runtime acknowledgements.
- Every new `init` now boots the accepted image under the verified kernel and
  fails unless the image launcher reports exactly `landlock: fully enforced`.
- `start` reserves Mac loopback through the proxy before container startup,
  creates or reuses the disposable container, waits for Web readiness, checks
  runtime policy, verifies the running kernel identity, and fails if either
  guest IPv4 or IPv6 can reach DSH directly.
- Same-port `start` is idempotent. A port change stops the old proxy and
  recreates only the disposable container so DSH receives the new trusted
  authority. A missing proxy is repaired without restarting the container.
- `status` reconciles running, stopped, or missing container state and reports
  proxy ownership, readiness, URL, guest addresses, and direct reachability.
- `logs` supports a bounded recent view and a redacted follow stream.
- `stop` terminates the container and exact owned proxy while preserving all
  persistent resources.
- Default `delete` removes only the disposable container and preserves the
  workspace, state, cache, and network.
- An existing workspace `.git` directory receives an explicit read-only bind
  overmount. Linked external git worktrees, symlinked `.git` paths, pointer
  files, and externally resolved metadata are unsupported in version 1; container
  creation fails closed with an explicit error. Phase 0 proved read-only
  overmount behavior live; command construction has a dedicated regression test.

## Live acceptance evidence

The exact installed Apple Container 1.2.2 runtime passed these checks:

- UI readiness returned HTTP 200 through Mac `127.0.0.1:30081`.
- `lsof` reported one listener on `127.0.0.1:30081` and no non-loopback Mac
  listener.
- DSH ran as UID/GID 1000 on Linux `6.18.5-cz-7800b4642171`.
- Apple inspect reported read-only root, `capDrop: ["ALL"]`, no published ports,
  no published sockets, 2 CPUs, 2 GiB memory, `nofile=1024`, and `nproc=512`.
- The writable set was exactly `/workspace`, `/state`, `/cache`, and `/tmp`.
  Writes to `/etc`, `/usr`, `/opt`, `/home`, and `/var` failed with read-only
  errors; `/root` failed with access denied.
- the host home directory, its SSH directory, the workspace parent, and a sibling
  `dotfiles` path were absent in the guest.
- The open-file probe stopped at 1004 added descriptors with `EMFILE`.
- The process probe stopped at 482 added processes with `EAGAIN`, demonstrating
  the configured process ceiling after existing guest processes were counted.
- HTTPS egress to `example.com` returned 200, matching the acknowledged live
  network posture.
- The image launcher returned `landlock: fully enforced` under the pinned
  kernel, both inside the managed instance and through the new init probe command.
- Guest IPv4 and IPv6 port 3080 connections failed. The manager repeats this
  check after every non-idempotent start and reports it in `status`.
- An allowed Host authority reached the DSH API, while `Host: evil.invalid`
  returned 403. This remains a Host fence, not authentication.
- DSH adopted `/workspace`, created a blank `standard` session, and opened its
  WebSocket event channel through the full exec-stream proxy.
- A 64-request HTTP burst and 32 concurrent WebSocket opens completed. Forced
  client disconnect left no proxy child process and the next UI request returned 200.
- Killing the owned proxy made `status` report `Proxy absent` and `not ready`.
  The next `start` created a new proxy without changing the container start time.
- Stop, default delete, and recreate preserved the host workspace file, DSH
  workspace ID, blank session ID, state volume, cache volume, and network.
- A temporary port change to 30082 served HTTP 200, removed the 30081 listener,
  and changing back to 30081 recreated the disposable container safely.

The first volume initializer attempt exposed a real partial-init failure: it
changed `/state` ownership before creating child directories. The retry used
the same exact resources, created all directories first, then chowned them in
reverse order with only `CAP_CHOWN` and `CAP_DAC_OVERRIDE`. No duplicate
network or volume was created. This is retained in the lifecycle journal as
failure-recovery evidence.

## Automated verification

`pnpm check` passed on 2026-08-18:

- Biome lint: pass
- TypeScript strict typecheck: pass
- Node tests: 25 passed, 0 failed
- production build: pass

The Nix package also passed `nix flake check`, `nix build .#dsh-container`,
packaged `doctor`, and packaged `status` against the live instance.

## Deferred to Phase 3 or later

- controlled host-native and container performance measurements
- repeated Apple service interruption and recovery testing
- browser-driven representative application-development evaluations
- functional CPU-throttling and memory-OOM measurements under controlled load
- resource snapshots and graceful-versus-forced shutdown fields in metadata
- selective destructive deletion targets beyond the safe default container delete
- offline networking, allowlisting, volume workspaces, Colima, and E2B

Other local macOS users remain outside the version 1 threat model. Provider
credentials entered into DSH remain readable to processes running as the same
guest user and should be disposable and scope-limited for evaluation.
