# Phase 3 evaluation record

Date: 2026-08-18

Status: PASS WITH AUTOMATED VISUAL EVIDENCE. The host-native comparison,
managed lifecycle evaluation, resource measurements, overload recovery,
cleanup contract, architecture adjudication, four representative real-model
tasks, and repository-owned Playwright visual gate are complete. The model
tasks used the containerized Web host's public API; their controlled persisted
transcript was subsequently rendered and verified at two viewports. The user
separately confirmed API-key onboarding and a model turn through the UI.

## Evaluation target

- trusted source: a clean local checkout of `deepseek-ai/deepseek-harness`
- DSH version: `0.1.0-rc.7`
- exact source SHA: `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`
- managed instance: `evaluation`
- UI: `http://127.0.0.1:30081/`
- Apple container: the deterministic manager-owned `evaluation` container
- image digest:
  `sha256:a9f384b239d75d6aca3448a7bb4ead0d6697fb9271e4b46b78849254dd4afc39`
- kernel: `6.18.5-cz-7800b4642171`
- limits: 2 CPUs, 2 GiB memory, `nofile=1024`, `nproc=512`

The reusable measurement driver is
`implementation/phase-3-benchmark.mjs`.
The reusable real-model scenario driver is
`implementation/phase-3-scenarios.mjs`.

## Host-native baseline preparation

The trusted checkout had no generated Web artifacts or complete runtime
dependency closure. The following preparation was required:

1. `CI=true pnpm install --frozen-lockfile`
2. explicit `pnpm run build`
3. production `pnpm deploy` closures for the CLI, SDK runtime packages, and
   four dynamically loaded services
4. the same flat runtime package materialization used by the accepted
   immutable-image recipe
5. `node --expose-internals .../lib/bin.js --profile web`

The explicit production build took 61.45 seconds. The Vite frontend portion
took 1.54 seconds.

Two source-distribution hazards were reproduced:

- `pnpm dsh --help` and the ambiguous `pnpm build` path entered DSH's dependency
  healer instead of behaving like ordinary pnpm script invocations. The latter
  pruned the checkout to production dependencies before failing to import
  `lefthook`. A frozen CI install restored the checkout.
- Direct source startup still failed after the build because the runtime-loaded
  native directory-picker package was absent from the ordinary dependency
  closure.

This evidence strengthens the immutable OCI image decision. A clean source
checkout is not itself a reproducible runnable DSH distribution.

## Startup, shutdown, and HTTP comparison

All values are local measurements from this machine. They are comparison data,
not general product benchmarks.

| Measurement | Host native | Apple managed path |
| --- | ---: | ---: |
| Startup cycle 1 | 804 ms | 3,061 ms |
| Startup cycle 2 | 573 ms | 2,983 ms |
| Startup cycle 3 | 579 ms | 3,040 ms |
| Mean startup | 652 ms | 3,028 ms |
| Typical stop | 28 to 33 ms | 457 to 690 ms |
| Stop with retained proxy connections | n/a | 3,669 ms |
| Sequential `/` p50 / p95 | 1.85 / 2.37 ms | 3.75 / 5.15 ms |
| Sequential `workspace.list` p50 / p95 | 1.92 / 2.35 ms | 4.77 / 8.81 ms |
| Eight-request burst, first connection set | 5.05 ms wall | 190 to 279 ms wall |
| Eight-request burst, retained connections | not separately measured | 24.7 to 30.6 ms wall |

The roughly 2 to 3 ms sequential request penalty and 3 second managed startup
are acceptable for a local evaluation tool. New concurrent connections are
substantially more expensive because each connection creates an Apple
`container exec` process and a guest Node connector. Retained HTTP connections
perform much better than their first request.

The host-native Node process used about 209 MiB RSS while ready. A representative
managed ready snapshot showed:

- guest cgroup memory: 383,115,264 bytes
- guest cgroup PIDs and threads: 81
- Mac proxy RSS: 69,904 KiB
- CPU throttling: none in the captured ready snapshot

After a graceful stop, the container was `stopped`, the proxy process no longer
existed, and TCP port 30081 refused connections. The instance was restored to
ready state in 3.16 seconds.

## Connection-pressure finding and hardening

Before hardening, simultaneous request bursts produced this pressure:

| Connections | Successful | Guest memory | Guest PIDs and threads |
| ---: | ---: | ---: | ---: |
| 16 | 16 | 534,384,640 bytes | 193 |
| 32 | 32 | 690,536,448 bytes | 305 |
| 48 | 48 | 847,003,648 bytes | 417 |
| 64 | failed | not stable | crossed the `nproc=512` ceiling |

At 64 connections, guest connector processes failed to create Node worker
threads, the proxy logged `pthread_create: Resource temporarily unavailable`,
and clients saw reset sockets. The DSH service itself recovered after connection
pressure drained.

The proxy now admits at most 32 total connections and responds to excess HTTP
connections with `503 Service Unavailable` plus `Retry-After: 1`. This limit was
selected from the measured 32-connection point, leaving substantial room below
the 512 ceiling while exceeding ordinary single-browser concurrency.

The Nix-installed build was restarted with the hardening in place. A live
64-request burst had 24 forwarded requests and 40 explicit HTTP 503 responses
because eight connections were already retained. Guest pressure stayed at 249
PIDs and threads, then returned to the 81 baseline. `status` remained ready.

A later API-key onboarding attempt exposed a separate idle-connection defect.
DSH advertises a five-second HTTP keep-alive timeout, but the original guest
connector used a half-open socket and kept its stdin alive after DSH closed the
other direction. A browser that reused that stale connection waited until the
Web client's 30-second unary deadline and displayed `signal timed out`.

The end-user transport sequence was reproduced against the live instance: the
first request completed, a second request written after seven idle seconds
never received a response, and the test timed out at 40 seconds. The connector
now destroys its stdin and exits when the guest socket closes or errors. After
installing the corrected Nix package, the same live connection received `end`
and `close` at about 6.14 seconds, before it could be reused. A regression test
covers guest-initiated keep-alive closure and bridge reaping.

## Persistence, cleanup, and recovery

Three repeated stop/start cycles preserved the exact workspace and session
identity:

- workspace identity: unchanged across all cycles
- session identity: unchanged across all cycles

Default cleanup was tested against the exact disposable container:

- `delete` removed only the deterministic `evaluation` container in 0.84 seconds.
- Both named volumes, the named network, and the exact bind workspace remained.
- `status` reported the container as missing and the proxy as absent.
- `start` recreated the disposable container in 3.44 seconds.
- The same workspace and session IDs were present after recreation.

Proxy failure recovery was tested separately. After first verifying the exact
manager-owned command identity, its proxy PID was terminated. `status` reported
`proxyMatches=false` and `ready=false` while leaving the container running.
`start` created a new owned proxy and restored readiness in 2.58 seconds.

Full deletion of selected persistent resources is not implemented by the
current CLI, so the plan's requested state, cache, network, and workspace
deletion acceptance cases remain open. Apple service interruption was not run
because it would also disturb the out-of-scope Phase 0 spike container.

## Representative real-model scenarios

The user stored a provider key through the Web onboarding modal after the idle
keep-alive fix. Only the value-free credential view was inspected afterward:
`configured=true`, `source=file`, and `writable=true`. The key was never read or
copied out of the instance.

A controlled dependency-free Node fixture was created at
`/workspace/phase3-app`. One new DSH session ran all four scenarios through the
containerized Web host using `deepseek-official/deepseek-v4-flash`:

| Scenario | Result | Time | Tool calls | Tool errors |
| --- | --- | ---: | ---: | ---: |
| Inspect small application | Correct architecture and risk report; 2 tests passed | 9.83 s | 6 | 0 |
| Constrained code change | Added `decrement` plus two tests in exactly two allowed files; 4 tests passed | 8.37 s | 4 | 0 |
| Plugin and composition discovery | Found and accurately summarized the shipped `editing-cordis-compositions` skill and related `cordis` preset | 18.63 s | 5 | 0 |
| Persisted session resume | Recalled and verified the prior change after a managed restart; 4 tests passed | 8.16 s | 3 | 0 |

The managed stop/start between the third and fourth turns took 4.42 seconds.
The same controlled session resumed across the restart. Across all four turns
DSH recorded 15 model steps, 42.45 seconds of model time, 0.87 seconds of tool
time, and no tool failures.

Independent host verification proved that `package.json` and `README.md` kept
their baseline hashes, only `src/counter.js` and `test/counter.test.js` changed,
and the final four tests pass both on macOS and inside the guest.

## Architecture adjudication

| Candidate work | Phase 3 decision | Evidence |
| --- | --- | --- |
| Immutable OCI image | Retain | Native preparation required a specialized multi-package runtime closure; a source checkout was not directly runnable. |
| Bind workspace | Retain for explicitly acknowledged local evaluation | Host editing and persistent sessions work, but the guest can modify all data in the exact bind. Broader or untrusted use should add a volume-backed mode first. |
| Volume workspace | Defer, with a clear trigger | Implement before untrusted repositories, parallel autonomous jobs, or workflows that should not directly mutate host files. It is not needed to finish the current trusted evaluation. |
| Offline enforcement | Do not add as the default | Provider calls require egress. A later restricted-egress proxy or allowlist is more useful than a binary offline mode. |
| Colima backend | Do not pursue now | Apple Container meets the current isolation and lifecycle goals. The measured transport cost alone does not justify replacing the backend. |
| E2B backend | Do not pursue for local version 1 | Revisit for remote execution, multi-user service operation, or stronger disposable cloud isolation. |
| Exec-stream proxy | Keep only for single-user evaluation | It carries the current UI and fails safely after the new admission cap, but one guest Node process per connection is not scalable. Product use should replace it with a persistent multiplexed guest bridge or another proven loopback-only transport. |

## Visual and interactive evidence

The final instance reports:

- `DEEPSEEK_API_KEY`: `configured=true`, `source=file`, `writable=true`
- selected provider/model: `deepseek-official` / `deepseek-v4-flash`
- model route: available, with no catalog failures
- official in-app or extension Browser instances: none connected

No host credential was searched for or imported. This is intentional credential
isolation. The four scenarios are complete through the same Web host API used by
the browser. The repository-owned Playwright suite then verified the DSH shell,
value-free configured-provider indicator, persisted transcript, reload, fatal
console errors, and reviewed screenshots at 1440x900 and 1024x768. Four visual
tests passed and two opt-in live-model tests remained correctly skipped.

Official interactive Browser evidence remains unavailable because the runtime
reported zero connected browser instances. A separately approved Chrome
DevTools diagnostic session loaded the live UI and transcript successfully; it
is recorded only as diagnostic evidence, not as official Browser evidence.

## Verification

- `pnpm check`: pass, 27 tests
- project Nix package build: pass
- `nix flake check --no-build`: pass
- Home Manager activation with the new Nix package: pass
- live 32-connection admission limit: pass
- real-model application scenarios: pass, 4 turns and 0 tool errors
- post-restart host and guest fixture tests: pass, 4 of 4
- Playwright visual gate: pass, 4 tests at 2 viewports
- official interactive Browser: blocked, no connected instance
- final `evaluation` status: running, proxy-owned, ready, direct guest network
  addresses unreachable
