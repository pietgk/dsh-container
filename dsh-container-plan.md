# DSH Container Evaluation Handoff v2

Status: Phase 0 accepted; Phase 1 complete; Phase 2 implementation and managed-instance validation in progress  
Prepared: 2026-08-17  
Target host: Apple Silicon MacBook, macOS 26.5.1

## Purpose

This document is the accepted implementation specification. It captures the investigation, chosen architecture, security model, command-line experience, and validation requirements for running DeepSeek Harness, abbreviated DSH, in an isolated local container environment.

The first implementation should provide a simple named-instance experience:

```text
dsh-container init
dsh-container start
dsh-container stop
dsh-container delete
```

The initial product is a deliberately narrow evaluation environment: one Apple Container backend, bind workspace mode, and live outbound networking. The design should leave clean extension points, but version 1 must not implement a second backend, volume workspaces, or a full network-policy product before DSH proves useful.

This file is the accepted implementation specification. Phase 0 proved the immutable image and security controls, but the originally proposed Apple Unix-socket publication path failed. The amended exec-stream transport passed the measured Web path and preserves the security invariants. On 2026-08-17, the user accepted the amended transport and pinned custom kernel and acknowledged the recorded dependency-audit findings for evaluation. Phase 1 may proceed.

## Evaluation objective

The practical goal is to determine whether DSH is useful for application development, with particular attention to:

- the everything-is-a-plugin architecture
- event-sourced sessions and reproducibility
- memory consumption and resource behavior
- interactive speed and startup time
- token use and token efficiency
- the quality of the Web UI and the overall development workflow

DSH's own session records, trajectory views, token information, and a small automatically collected lifecycle record should support the evaluation. A separate human evaluation journal is intentionally out of scope for version 1.

Startup, interaction, and memory measurements from the container are not host-native DSH measurements. Run the same controlled smoke scenario host-native as a baseline, using trusted evaluation code only, and report at least:

- host-native DSH process startup and resident memory
- Apple Container guest DSH process startup and resident memory
- end-to-end Apple Container startup and host memory attributable to its VM
- interaction latency measured over repeated equivalent requests, with provider and network variance called out

Do not use the host-native baseline to run unfamiliar or untrusted code.

## Current observations

These facts describe the inspected machine and repository on 2026-08-17. Treat them as evidence to recheck, not timeless assumptions.

### DSH checkout

- Repository: `https://github.com/deepseek-ai/deepseek-harness.git`
- Inspected revision: DSH `0.1.0-rc.7`
- Inspected commit: `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`
- The checkout had the official upstream remote.
- The source checkout is suitable as a source transport, but the container build must always select an immutable commit SHA.
- Local working-tree changes, ignored files, `.env` files, `.git`, and `node_modules` must never enter the build context.

### Installation warnings

The large `pnpm install` log did not show a failed installation.

- The repeated `File descriptor ... unmanaged mode` lines were Node runtime diagnostics emitted while pnpm performed concurrent file and subprocess work.
- The two missing-bin warnings referred to demo packages whose `lib/bin.js` files had not yet been built in the fresh workspace.
- pnpm finished successfully with `Done in 23.9s`.
- Successful installation is not proof that a package is safe to run. The isolation design below remains necessary.

### Dependency audit

At the inspected revision, `pnpm audit --prod --json` reported:

- 0 critical vulnerabilities
- 12 high vulnerabilities
- 12 moderate vulnerabilities
- 1 low vulnerability

These counts change over time and must be recomputed for every selected DSH revision. Version 1 may proceed only after an explicit acknowledgement of high-severity findings. A critical finding blocks initialization unless the policy is deliberately changed in a later design review.

### Existing local runtimes

- Apple Container `1.2.2` was installed through the user's Nix-managed Homebrew declaration and its service was initialized.
- Colima `0.10.3` was installed.
- The existing Colima `default` profile was stopped and configured for the Docker runtime.
- The project must never start, stop, reconfigure, or delete that `default` profile.
- Docker Desktop and a host Docker CLI are not required by the chosen design.

### Load-bearing source findings

At the inspected DSH commit:

- `dsh web` is an alias for `dsh --profile web`.
- The Web CLI accepts `--host`, `--port`, and `--trusted-host`.
- [`startup.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/bundle/web-app/src/startup.ts#L67-L72) explicitly rejects `--host 0.0.0.0` because broad binding would expose remote code execution.
- `--trusted-host` controls a browser Host-header trust fence. It is not user authentication.
- The Web surface has no independent bearer-token or login boundary that makes network reachability harmless.
- [`process-shutdown.ts`](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/apps/cli/src/process-shutdown.ts#L1-L5) defines a five-second whole-application disposal timeout. A supervisor grace longer than five seconds is therefore justified, while still requiring revalidation for another DSH revision.
- The root build runs host and client TypeScript builds, two `tsdown` faces, and the Web frontend build.
- Linux sandbox execution also needs the repository's `landlock-run` static C launcher. Its binary is git-ignored and absent from `git archive`; a source image build must run the native Linux build with `musl-gcc`. It is not an N-API addon.

For Apple Container 1.2.2 documentation and source:

- published TCP ports may be bound to Mac loopback, but that does not by itself make a service bound to the guest network interface unreachable through the guest's vmnet address
- a dedicated Apple Container network isolates it from other container networks, not from the Mac host
- `--publish-socket`, `--read-only`, `--tmpfs`, `--cpus`, `--memory`, and `--ulimit` are available
- `--ulimit nofile=...` and `--ulimit nproc=...` provide open-file and per-user process ceilings for the non-root DSH user

Phase 0 functionally exercised the relevant controls on Apple Container 1.2.2. `--publish-socket` exists, but it cannot relay a socket created on an OCI tmpfs or named-volume mount when the container root filesystem is read-only. The default Apple kernel also lacks Landlock support, so version 1 requires the exact custom kernel described below.

## Review adjudication

The external review materially improves the plan, but not every claim is correct.

| Review point | Verdict | v2 action |
| --- | --- | --- |
| Apple loopback publication leaves a guest-interface path | Valid | DSH remains bound to guest loopback. The Unix-socket bridge failed under read-only-root constraints; the amended exec-stream proxy passed direct guest-IP denial and now requires architecture approval. |
| DSH rejects `--host 0.0.0.0` | Valid | Do not bypass the guard through config or `--host ::`. Make the supported DSH invocation part of the transport spike. |
| The source build hides significant work | Valid in substance | Keep source provenance, but specify the TypeScript, Web, and native static-musl build and prove it in a clean multi-stage build. The review's N-API wording is incorrect. |
| Read-only rootfs lacks a writable-path design | Valid | Define the complete writable mount set and test real package installs, builds, and language tooling against it. |
| Offline cannot be the normal evaluation posture | Valid | Version 1 operates in explicitly acknowledged live mode. Offline enforcement is a later feature, not a default that prevents provider use. |
| VM measurements distort speed and memory results | Valid | Add a controlled host-native baseline and distinguish guest-process, VM, and end-to-end measurements. |
| The five-second disposal window was unverified | Incorrect for the inspected commit | Retain it with the exact source reference and revalidate it for every selected revision. |
| Colima image transfer and profile topology were undecided | Valid | Remove Colima from version 1. If later promoted, use one profile per instance and import a saved OCI archive into that profile's containerd store. |
| Apple Container cannot set process or open-file limits | Incorrect for 1.2.2 | Use and functionally test `nproc` and `nofile`; record their RLIMIT semantics rather than claiming Docker cgroup parity. |

The review's suggested invariant, "not reachable by other host users," is also too strong for an ordinary TCP listener on Mac loopback. Version 1 protects against non-loopback network reachability and accidental LAN exposure. Malicious local macOS accounts are outside its threat model. The browser-facing loopback TCP proxy is not a per-user authentication boundary.

The review-cited Apple Container issue 919 concerns broken TCP forwarding in version 0.6.0. It does not establish the direct-reachability claim for 1.2.2. That claim instead follows from Apple Container's documented vmnet model and direct host access examples, and must be confirmed by Spike A on the installed release.

## What DSH currently isolates

DSH has its own tool permission and filesystem policy. The inspected default profile limits workspace writes and asks for some actions, but it is not a complete host security boundary.

In particular, the DSH sandbox should not be assumed to confine:

- reads outside the workspace
- outbound networking
- visibility of other same-user processes
- same-user credentials or environment variables
- all behavior of native dependencies and subprocesses

The local container or VM is therefore the primary isolation boundary. DSH's own permissions remain valuable as defense in depth.

## What the documented E2B sandbox is

The repository's E2B packages are an experimental proof of concept for remote execution. They adapt DSH filesystem and subprocess capabilities to an E2B sandbox. They do not isolate the entire local harness process, UI, credentials, session state, provider traffic, or every plugin.

E2B is therefore not the selected foundation for this local Mac workflow. It may be evaluated later as an additional remote execution backend, but it must not be described as equivalent to running the complete DSH environment inside a local VM-backed container.

## Chosen architecture

### Backend strategy

Build a TypeScript CLI around Apple Container only for version 1. Persist `backend: apple` in metadata so a later backend can be added without changing instance identity or lifecycle semantics, but do not expose an unimplemented backend choice.

Apple Container remains the proposed version 1 backend because it gives every container a lightweight VM and avoids Docker Desktop or a host Docker daemon. Phase 0 proved the image, lifecycle, Landlock confinement, guest-loopback isolation, and an amended Web transport. It also exposed two load-bearing requirements: a pinned custom Linux kernel and an exec-stream Mac loopback proxy. The backend is accepted only if the user approves those requirements after reviewing the evidence.

Colima is a contingency, not a parallel version 1 deliverable. If an Apple spike fails, stop and amend this architecture before implementing the CLI. Do not silently fall back.

If Colima is promoted later:

- use containerd and `colima nerdctl`
- use one dedicated profile per DSH instance, accepting its disk cost in exchange for a clear isolation boundary
- never reuse or modify the existing `default` profile
- transfer the content-addressed image with an OCI archive and `colima nerdctl image load`; do not assume Apple Container and Colima share an image store
- never mount the user's home directory, forward the SSH agent, install host SSH configuration, or modify a Docker context

### Backend interface

The internal interface should express product operations rather than raw runtime commands. A likely capability set is:

```text
probeHost()
createNetwork()
buildImage()
createContainer()
startContainer()
stopContainer()
deleteContainer()
deleteState()
inspectInstance()
streamLogs()
startUiProxy()
stopUiProxy()
verifyNetworkPolicy()
verifyKernelIdentity()
```

The exact TypeScript names may change. Keep Apple Container command construction behind this interface, but do not design for false parity with a backend that version 1 does not implement.

### Mandatory feasibility spikes

Do not create the manager project skeleton until both spike records are complete and every architecture-changing result is accepted. Run them manually with disposable, exactly named resources and retain commands and results in a short spike record.

#### Spike A: Web UI transport and exposure

The original path was tested and failed on Apple Container 1.2.2:

```text
Mac browser -> Mac loopback proxy -> Apple published Unix socket
            -> guest Unix socket on tmpfs or volume -> guest-loopback DSH
```

Apple's relay resolves the guest socket beneath the immutable rootfs view. It cannot see sockets created on `/tmp` tmpfs or `/state` volume mounts, while the read-only rootfs cannot accept a relay-visible socket. Both tested mount locations produced a host socket that reset connections. Making the rootfs writable would weaken a core security invariant and is rejected.

The replacement candidate passed the measured path:

```text
Mac browser -> manager proxy on 127.0.0.1:<host-port>
            -> one interactive `container exec` byte stream per TCP connection
            -> guest connector -> DSH on guest 127.0.0.1:<guest-port>
```

The spike proved the built frontend, HTTP and API requests, a DSH event WebSocket, Host-header fencing, graceful stop and restart, persisted session state, and refusal through both guest vmnet IPv4 and IPv6. The container has no published ports or sockets and the Mac has no non-loopback listener.

The accepted candidate preserves read-only rootfs and guest-loopback-only DSH binding, but costs one Apple exec stream per browser TCP connection. Phase 1 must own, identify, health-check, close, and reap every child process, and Phase 2 must load-test connection count, reconnection, shutdown, and Apple service interruption. The user approved this amendment on 2026-08-17.

#### Spike B: immutable source image

From a clean `git archive` of the selected DSH SHA, prove a multi-stage Linux/arm64 build that:

1. installs exactly the repository-declared pnpm version and frozen lockfile dependencies
2. installs `musl-gcc` in the builder and runs `pnpm --dir native/landlock-run build:native`
3. runs the root host/client TypeScript and `tsdown` builds and the Web frontend build
4. verifies that the Linux arm64 `landlock-run` binary exists and functionally enforces Landlock under the pinned custom Apple kernel
5. proves the runtime can execute as a non-root UID/GID while writing the exact bind workspace, state volume, cache volume, and tmpfs paths; use a separately scoped one-shot volume initializer if ownership must be established
6. assembles a production runtime closure without builder tools, source-control data, registry credentials, or caches
7. starts `dsh web`, serves the built frontend, runs a constrained shell action, persists a session, and exits gracefully

Version 1 deliberately chooses the source build over `npx @deepseek-ai/dsh`. The published npm artifact is simpler and has a registry integrity hash, but the queried release metadata did not provide a commit `gitHead`, and its internal dependency ranges require an additional generated lock to freeze the complete release family. Exact-SHA provenance and source auditability are more important here than image-build simplicity.

Spike B passed for DSH SHA `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`. The image accepted for evaluation is the OCI index digest `sha256:a9f384b239d75d6aca3448a7bb4ead0d6697fb9271e4b46b78849254dd4afc39`. The user acknowledged the recorded 12 high and 12 moderate production dependency findings on 2026-08-17.

## Resource model

Each named instance owns or references the following resources:

| Resource | Ownership | Persistence |
| --- | --- | --- |
| Instance metadata | DSH container manager | Until explicit state deletion |
| Runtime container | Disposable | Recreated when configuration requires it |
| DSH state volume | Per instance and DSH SHA | Survives stop and container deletion |
| Rebuildable cache volume | Per instance and DSH SHA | Survives stop; independently deletable |
| Workspace | Exact managed host bind directory | User-selected lifecycle |
| Image | Shared by immutable DSH commit and build policy | Removable only when unreferenced |
| Pinned Apple kernel | Shared by verified kernel digest and backend policy | Removable only when unreferenced |
| Apple network | Per instance | Preserved while the instance exists |
| Mac loopback proxy | Per running instance | Removed after stop |
| Per-connection exec streams | Owned by the running proxy | Closed and reaped after connection or stop |
| Audit and lifecycle record | Per instance | Stored with instance metadata |

Names must be deterministic, collision-resistant, and derived from the logical instance name plus a stable internal identifier. Never discover deletion targets using broad globs.

The loopback proxy must be an explicit manager sub-process with recorded PID, process start identity, port, logs, and health. It must track each child `container exec` stream and close child stdin to end the stream cleanly rather than relying on Apple signal forwarding. `start`, `status`, and `stop` must distinguish the owned proxy from an unrelated process that later reuses the same PID. Do not leave an untracked detached proxy or exec child behind.

## Source and image build policy

### Immutable source selection

The implementation must build from an exact official DSH commit:

1. Fetch or inspect the official repository.
2. Resolve the requested release or branch selection to a full commit SHA.
3. Verify the SHA belongs to the expected official remote history under the chosen policy.
4. Create the source input with `git archive <sha>`.
5. Record the remote URL, full SHA, version, commit date, and subject.

Do not send the live checkout as the build context. In particular, exclude:

- `.git`
- `node_modules`
- `.env` and other credential files
- ignored files
- untracked files
- modifications not present in the selected commit

### OCI image

Use a multi-stage OCI build:

- pin the Node base image by digest
- use the pnpm version declared by the repository
- install from the lockfile using frozen resolution
- build the Linux arm64 static-musl `landlock-run` launcher from the selected source
- build both DSH library faces and the Web frontend
- copy only runtime artifacts and production dependencies into the final image
- use a non-root runtime user
- include the minimal guest-side connector used by the exec-stream proxy
- use a small init or supervisor that starts DSH, forwards signals, and reaps children
- add a health or readiness check that reflects actual Web UI readiness

The final image must not contain source-control credentials, package-manager credentials, build caches, the host checkout, or a writable copy of Git metadata from a bind-mounted workspace.

The Apple backend must boot each DSH instance with the verified custom kernel built from Apple Containerization 0.40.1 plus the minimal Landlock configuration patch. For the Phase 0 candidate, the kernel SHA-256 is `5ac12b28ec01f5ed89f4a6397a29a422b3e615f2b382d8ec328991b1a3953d1b`. Treat the kernel recipe, source revision, patch digest, artifact digest, and runtime kernel identity as immutable build inputs. Initialization must fail if the verified kernel is missing or its Landlock functional probe does not enforce a denied write.

Record the base image digest, source SHA, Dockerfile or Containerfile digest, lockfile digest, native launcher digest, final image digest, and exact build command. Image reuse is allowed only when every build input identity matches.

### Audit gate

`init` must run and record a production dependency audit for the selected revision.

- Critical findings: block by default.
- High findings: show a concise summary and require explicit acknowledgement.
- Moderate and low findings: record and display without an extra gate.
- Record the audit tool, invocation, timestamp, result counts, and selected DSH SHA.

The gate evaluates known dependency reports. It does not claim the resulting image is safe.

## Runtime security policy

Apply these controls to every version 1 instance:

- non-root user
- read-only root filesystem
- dropped Linux capabilities
- no privileged mode
- no host PID, IPC, or network namespace
- bounded CPU, memory, process count, and open-file limits
- the explicit writable mount set below and no other writable rootfs paths
- no host home-directory mount
- no SSH agent socket
- no cloud, package registry, Git, or model-provider credentials inherited from the host
- no access to sibling workspaces
- no writable host Git metadata in the container
- DSH bound only to guest loopback
- a manager-owned Mac loopback proxy with owned per-connection exec streams as the only Web path
- the exact verified custom Apple kernel with functional Landlock support

For Apple Container 1.2.2, use `--read-only`, `--tmpfs`, `--cap-drop ALL`, `--cpus`, `--memory`, `--ulimit nproc=...`, and `--ulimit nofile=...` after proving their behavior on the installed release. `nproc` is an RLIMIT for the non-root guest user, not a claim of cgroup PID-controller parity.

The complete planned writable set is:

| Guest path | Backing | Purpose | Persistence |
| --- | --- | --- | --- |
| `/workspace` | Exact host bind | Project edits and project-local dependencies | Host-managed |
| `/state` | Named volume | `DSH_HOME`, settings, credentials, sessions, and necessary user-home state | Persistent and SHA-coupled |
| `/cache` | Named volume | npm, pnpm, Corepack, XDG, language-server, and tool caches | Rebuildable |
| `/tmp` | Size-bounded tmpfs | Temporary build and subprocess files | Until stop |

Set `HOME`, `DSH_HOME`, `XDG_CACHE_HOME`, `COREPACK_HOME`, npm cache, and pnpm store paths explicitly into `/state` or `/cache`. Verify real installs, builds, subprocesses, and any language-server setup without discovering another required writable rootfs path. A missing required path is a failed spike or acceptance test, not permission to remount the root filesystem writable.

If a required control cannot be enforced, initialization must fail and name the limitation. It must not quietly weaken the profile.

## Workspace

Version 1 supports bind mode only.

- Managed host location: `$DSH_CONTAINER_WORKSPACE_ROOT/<name>`
- Mount only that exact directory into the guest.
- Do not mount the host home, workspace parent, or another broad parent directory.
- Ensure Git metadata is read-only from inside the container, preferably with an explicit overmount.
- Open the project in Zed Restricted Mode until the user trusts it.
- Prove the selected non-root guest UID/GID can write the bind workspace without making it broadly writable on the Mac.
- Container edits should appear immediately in Zed.
- Host-side Git remains the trusted path for staging, reviewing, committing, and pushing.

The implementation must clearly warn that a malicious process can change or delete any writable file inside the bound workspace. Bind mode protects the rest of the host, not the mounted project data.

Volume mode remains the preferred future option for unfamiliar or higher-risk repositories, but its import, export, backup, and deletion semantics are deferred until after the evaluation. Version 1 must say clearly that bind mode protects the rest of the host, not the mounted project data.

## State and credentials

Store DSH home and session state in a per-instance named volume. State may include settings, credential references or stored credentials, and sessions.

- Never automatically reuse a state volume with a different DSH revision.
- If the requested revision differs, create a distinct state set or require a deliberate migration action.
- Do not import the host's DSH, Codex, Claude, Git, SSH, npm, pnpm, or cloud configuration.
- Configure model-provider credentials through the DSH Web UI.
- Use disposable, restricted provider keys for evaluation.
- Explain that any agent process running as the same guest user may be able to read credentials available to DSH.
- After a risky evaluation, rotate the key and delete the instance state when appropriate.

Signing into the Web UI from the Mac does not grant DeepSeek API access. A provider credential is still required for real model calls. The UI may also configure supported alternative providers or custom OpenAI-compatible endpoints.

Disable telemetry through an authoritative supported setting. Verify it through observed behavior or configuration ownership rather than relying only on an environment variable whose effect is unknown.

## Network posture

### Version 1 operating mode

Version 1 uses live outbound networking because provider calls, package installation, and ordinary application-development work require it.

- Require explicit acknowledgement during `init`, and record it with the exact policy text and timestamp.
- The guest has unrestricted outbound DNS and IP connectivity through Apple Container networking.
- No inbound Web path may exist through the guest network interface. The proposed version 1 Web path is the guest-loopback to per-connection exec stream to Mac-loopback proxy proven by amended Spike A.
- Do not imply that unrestricted egress is safe.
- Use a disposable, scope-limited provider key and rotate it after risky evaluation work.

Offline mode is not a version 1 product feature. It may be added only after direct public-IP blocking, DNS blocking, and continued Web bridge access are proven from inside the guest. An allowlisting proxy is likewise deferred until the guest cannot bypass it with direct DNS or IP connections.

## Web UI exposure

The Web UI is the primary user interface for DSH.

- Keep DSH bound to `127.0.0.1` inside the guest.
- Do not publish an Apple TCP port or Unix socket for DSH.
- Expose DSH through a manager-owned TCP proxy bound only to Mac `127.0.0.1`; for every accepted TCP connection, open one owned interactive `container exec` byte stream to a minimal guest connector that dials DSH guest loopback.
- Select or validate a host port without racing another process.
- Pass DSH the correct trusted host or authority value.
- Wait for application readiness before opening the browser.
- Record the local URL in metadata and show it in `status`.
- Treat `--trusted-host` only as a Host-header fence, never as authentication.
- State that other local macOS users are outside the version 1 threat model.

Do not pass `--host 0.0.0.0`, `--host ::`, or alter DSH config to bypass its CLI safety check. Do not use ordinary Apple TCP port publication for DSH. Do not make the rootfs writable to regain Apple Unix-socket publication. The manager must fail closed if its exec-stream proxy or guest connector cannot preserve the measured loopback-only path.

## CLI contract

The executable name in this plan is `dsh-container`. A different short name may be selected before implementation, but the behavior should remain stable.

### `dsh-container init`

Purpose: create a named, reproducible evaluation environment without starting an unreviewed live session.

Inputs:

```text
--name <name>
--dsh-ref <ref-or-sha>
```

Behavior:

1. Validate the instance name and reject collisions.
2. Probe Apple Container and explain missing prerequisites.
3. When `--dsh-ref` is absent, offer a small interactive list of recent official DSH version commits showing version, date, subject, and full SHA.
4. Resolve the selection to an immutable full SHA.
5. Create a clean source archive from that SHA.
6. Run the dependency audit gate.
7. Build or reuse the exact content-addressed image.
8. Show and require acknowledgement of live unrestricted egress and bind-workspace data risk.
9. Verify or build the pinned Landlock-capable Apple kernel, then create instance metadata, state and cache volumes, bind workspace, dedicated Apple network, and backend resources.
10. Write the initial lifecycle record.
11. Do not silently mutate an existing instance whose immutable configuration differs.

Noninteractive use must be possible when all required inputs are supplied.

### `dsh-container start`

Inputs:

```text
--port <port>
--open
--open-editor
```

Behavior:

1. Reconcile persisted metadata with actual backend resources.
2. Recreate the disposable container if its immutable configuration changed or it is absent.
3. Apply resource, mount, and security controls.
4. Verify the configured custom-kernel digest and start DSH on guest loopback.
5. Start the manager-owned Mac loopback proxy without a port-selection race; open and own one interactive exec stream for each accepted TCP connection.
6. Verify that the proxy can reach DSH without a published Apple port or socket.
7. Wait for readiness through the public Mac URL with a bounded timeout and useful diagnostics.
8. Recheck that the guest network addresses cannot reach DSH and that no non-loopback Mac listener exists.
9. Optionally open the browser.
10. Optionally open the bind workspace in Zed, preferably in Restricted Mode.

Repeated `start` calls should be idempotent and report an already-ready instance accurately.

### `dsh-container stop`

Behavior:

1. Send a graceful termination signal.
2. Allow more than the inspected DSH CLI's five-second whole-application disposal timeout before forcing termination; use a documented wrapper deadline and revalidate the inner timeout for every DSH revision.
3. Record whether shutdown was graceful or forced.
4. Stop accepting new proxy connections, close and reap every owned exec stream, then stop the Mac proxy.
5. Preserve state, cache, workspace, image, and Apple network.
6. Be idempotent when the instance is already stopped.

### `dsh-container delete`

Default behavior deletes only the disposable container for the named instance.

Additional deletion targets must be independent and explicitly confirmed:

- instance state
- rebuildable cache
- bind workspace
- managed Apple network
- unreferenced image

`--all` may select all owned resources, but it must still show exact resolved targets and require confirmation.

- A managed host bind workspace should be moved to the macOS Trash when practical.
- State-volume deletion is irreversible and must say so.
- Shared images may be removed only when no instances reference them.
- Never delete resources identified only by an unresolved variable or broad wildcard.

### `dsh-container status`

Show reconciled state, including:

- instance name
- backend and Apple resource names
- DSH version and full commit SHA
- bind workspace location
- live-egress acknowledgement
- Web UI URL
- UI bridge and direct-guest-reachability status
- readiness and health
- resource limits and current usage when available
- running, stopped, missing, or drifted resource state
- last exit result

Do not print secrets.

### `dsh-container logs`

Stream or print DSH and lifecycle logs for the named instance. Support a bounded recent view and follow mode. Redact known secret fields and avoid copying full session transcripts into manager logs.

## Minimal lifecycle record

Maintain one versioned per-instance JSON record and a concise `status` view. Do not build a separate event-sourcing system. Store only what is needed to reproduce the environment, enforce safe cleanup, and interpret the evaluation:

- manager schema version
- instance identifier and name
- creation and update timestamps
- backend and backend version
- DSH remote, version, and full SHA
- base image digest and final image identity
- dependency audit summary and acknowledgements
- workspace, state, cache, Apple network, kernel, proxy, and exec-stream ownership identifiers
- live-egress and bind-risk acknowledgements
- configured security controls and their functional verification results
- resource limits
- startup and readiness timing
- one ready-time and one stop-time resource snapshot when available
- graceful or forced shutdown result
- last container exit code and reason

Do not duplicate DSH session events or model transcripts. Reference DSH's own persisted session data where useful.

## Failure behavior

Failures must be loud, specific, and recoverable.

- Missing backend: show the exact prerequisite and installation guidance, but do not run `sudo` automatically.
- Partial initialization: record created resources so a retry or delete can reconcile them.
- Port conflict: choose another explicit port or fail before starting, without publishing broadly.
- Readiness failure: keep diagnostic logs and report the last known process state.
- Metadata drift: show expected versus observed resources before modifying anything.
- Unsupported security control: fail unless the documented profile explicitly permits that limitation.
- Version mismatch: never attach old state automatically to a newly selected DSH SHA.
- Destructive operation: resolve and display exact targets before confirmation.

## Implementation sequence for the fresh session

The fresh session should follow these gates. It must not begin by adding features to the DSH repository itself.

### Phase 0: mandatory revalidation and spikes

- Recheck host architecture, macOS, Node, pnpm, Zed, and Apple Container versions.
- Retain Apple Container through the accepted Nix-managed Homebrew declaration.
- Recheck the DSH official remote, current release commits, build commands, Web UI entry point, state paths, telemetry setting, and graceful shutdown timeout.
- Confirm Apple Container command syntax from the exact installed release's primary documentation.
- Run Spike A for the proposed Web path, record the failed Unix-socket design, and prove the exec-stream replacement.
- Run Spike B for the immutable source image and Linux native launcher.
- Record commands, results, and any deviation. Require explicit acceptance of the architecture amendment and high-severity audit findings before Phase 1.

### Phase 1: project skeleton

- Create a separate TypeScript manager project.
- Define versioned metadata, the Apple backend adapter, and exact resource naming.
- Add dry-run and exact-target reporting from the beginning.
- Add the minimal lifecycle record, secret redaction, and partial-failure journal.
- Add pinned-kernel acquisition, digest verification, runtime identity checks, and the manager-owned exec-stream proxy as first-class backend components.

Phase 1 completed on 2026-08-17. The implementation record is in `implementation/phase-1-record.md`. The compiler, linter, 18 tests, production dependency audit, built CLI diagnostics, exact no-write plan, and Nix flake evaluation passed. Phase 2 may implement lifecycle behavior, but it must not create a live named instance until the user explicitly acknowledges unrestricted guest egress and bind-workspace data risk.

The user explicitly acknowledged unrestricted guest egress and bind-workspace data risk on 2026-08-17 and authorized Phase 2.

### Phase 2: Apple vertical slice

- Implement one named bind-mode instance through `init`, `start`, `status`, `logs`, `stop`, and default `delete`.
- Implement the read-only rootfs and complete writable mount set.
- Implement the manager-owned Mac loopback proxy and guest connector exactly as spiked, with complete exec-child accounting and reaping.
- Apply live-egress acknowledgement and resource ceilings.
- Prove persistence, version separation, safe cleanup, and direct guest-IP non-reachability.

Phase 2 completed on 2026-08-18. The implementation and live acceptance record
is in `implementation/phase-2-record.md`. The managed `evaluation` instance was
left running at `http://127.0.0.1:30081/`. Performance baselines, representative
application-development tasks, controlled resource snapshots, and repeated
Apple service interruption remain Phase 3 work.

### Phase 3: evaluation

- Run the controlled host-native performance baseline on trusted code.
- Run representative DSH application-development tasks through the containerized Web UI.
- Capture ready-time and stop-time resource snapshots and readiness timings.
- Verify restart, persistence, cleanup, and failure recovery repeatedly.
- Decide from evidence whether DSH merits volume workspaces, offline enforcement, Colima, or E2B work.

Phase 3 infrastructure evaluation ran on 2026-08-18. Host-native and managed
performance baselines, ready and stopped resource snapshots, repeated restart,
default cleanup, persistence, proxy failure recovery, and architecture
adjudication are recorded in `implementation/phase-3-record.md`. A measured
64-connection failure caused the exec-stream proxy to gain a 32-connection
admission limit with explicit HTTP 503 overload behavior. A later API-key UI
timeout caused the guest connector to gain correct idle keep-alive closure and
reaping. Four representative real-model scenarios passed through the Web host,
including a constrained tested code change and persisted resume across restart.
Repository-owned Playwright visual transcript inspection passed at 1440x900 and
1024x768. Official interactive Browser review remains unavailable because no
in-app or extension Browser instance is connected; diagnostic drivers are not
reported as official Browser evidence.

## Validation plan

### Unit and component coverage

Cover at least:

- CLI parsing and noninteractive invocation
- instance-name validation
- deterministic resource naming
- metadata schema validation and upgrades
- source-ref resolution to full SHA
- state-machine transitions and idempotency
- port selection and conflict handling
- audit policy decisions and acknowledgement records
- exact deletion target resolution
- secret redaction
- backend command construction
- partial-failure reconciliation

### Apple lifecycle suite

Run the behavioral suite against the exact installed Apple Container release, with 1.2.2 as the currently reviewed target.

Prove:

- `init` creates only named managed resources.
- `start` reaches a healthy Web UI.
- restart preserves state and workspace.
- `stop` is graceful when DSH cooperates.
- default `delete` preserves state and workspace.
- requested state and workspace deletion remove only exact owned targets.
- `status` detects stopped, missing, and drifted resources.
- `logs` works without revealing configured secrets.
- the Mac loopback proxy and every owned exec stream are removed on stop and recreated safely on restart.

### Security acceptance tests

Prove that the guest cannot read:

- the Mac home directory
- SSH agent sockets
- host Git credentials
- host package-manager credentials
- model-provider credentials not entered into that instance
- sibling workspaces

Also prove:

- DSH listens only on guest loopback.
- the Mac-facing proxy listens only on Mac loopback.
- Apple reports no published ports or sockets for the instance.
- HTTP, API, WebSocket events, reload recovery, and readiness behavior work through the full proxy.
- connection churn, browser concurrency, manager shutdown, and Apple service interruption leave no exec children behind.
- every guest vmnet IPv4 and IPv6 address fails to reach the DSH Web service.
- a request with an untrusted Host authority is rejected, while recognizing this as a Host-header fence rather than authentication.
- no rootfs path outside `/workspace`, `/state`, `/cache`, and `/tmp` is writable.
- CPU, memory, `nproc`, and `nofile` ceilings are functionally exercised rather than inferred from command success.
- the running kernel identity matches the pinned artifact and Landlock functionally denies a prohibited write.
- Git metadata is not writable from inside a bind-mode guest.
- Bind-mode file edits appear on the host and in Zed.
- Host-side Git can stage, commit, and push bind-mode changes.
- Selecting a different DSH SHA creates or requires distinct state and image identities.
- the existing Colima `default` profile remains byte-for-byte configuration-equivalent and retains its original running or stopped state, even though version 1 does not use Colima.

Also verify the documented limitation: another local macOS account is outside the version 1 threat model. Do not write a test whose name implies per-user TCP isolation.

### Evaluation smoke scenarios

Run representative DSH sessions that:

- inspect a small application
- make a constrained code change
- exercise plugin discovery or composition
- resume a persisted session
- inspect trajectory and token information
- run package installation, a build, tests, and representative language tooling against the read-only-root writable set
- compare host-native and Apple Container startup, memory, and interaction measurements using the same trusted scenario
- inspect the real Web UI at representative viewport sizes and record screenshots of any visual defects that affect the evaluation

The purpose is practical evaluation, not a formal model benchmark. Preserve the minimal lifecycle record and DSH sessions, but do not create a parallel human journal in version 1.

## Explicit non-goals for version 1

- Docker Desktop installation or dependency
- host Docker daemon or Docker context integration
- Kubernetes
- automatic `sudo` or unattended system software installation
- mounting the entire home directory
- sharing the host SSH agent or credential stores
- transparent backend fallback
- claiming complete parity between Apple Container and Colima
- a Colima backend
- volume workspace mode
- offline mode as a supported operating mode
- a mandatory egress proxy before bypass resistance is proven
- E2B as a substitute for whole-harness isolation
- automatic state migration across DSH revisions
- a human evaluation journal
- modifying DSH itself to make the container manager work

## Decisions to revisit later

These are deliberately deferred until the version 1 evidence exists:

- whether signed release tags or another provenance mechanism should be mandatory in addition to commit selection
- whether to add an enforceable provider allowlisting proxy
- whether bind workspaces need automatic snapshots or backups
- whether to add volume mode with explicit import, export, backup, and deletion commands
- whether Colima should be implemented using the selected one-profile-per-instance and OCI-import design
- whether the Web UI needs authentication or a per-user host boundary for protection from other local macOS accounts
- whether E2B adds useful remote subprocess isolation for selected plugins
- whether the environment should evolve into a full daily work environment with language servers, browser automation, and additional development services

## Assumptions requiring revalidation

- Host is Apple Silicon and running macOS 26.5.1.
- Node is `24.18` and pnpm is `11.7`.
- Zed is `1.15` and Restricted Mode remains available.
- Apple Container `1.2.2` is installed through the Nix-managed Homebrew declaration and its API service is running.
- Colima `0.10.3` is installed.
- Existing Colima `default` is stopped, uses Docker runtime, and must remain untouched.
- No Docker Desktop or host Docker CLI is required.
- Apple Container 1.2.2 supports `--read-only`, `--tmpfs`, `--cap-drop`, `--ulimit nproc`, and `--ulimit nofile`; Phase 0 functionally exercised them.
- Apple `--publish-socket` cannot relay a socket created on the required writable mounts while the root filesystem remains read-only.
- The exec-stream proxy can carry current DSH HTTP, API, and WebSocket traffic while DSH remains on guest loopback; Phase 2 still must exercise sustained load and failure recovery.
- A dedicated Apple network plus guest-loopback binding prevented direct access to DSH through the tested guest IPv4 and IPv6 addresses.
- The default Apple kernel lacks Landlock, and the Apple backend therefore requires the exact verified custom kernel and functional probe.
- Bind mode is sufficient for the controlled evaluation; volume mode remains the stronger future option for unfamiliar code.
- Live unrestricted egress is the honest version 1 operating posture.
- DSH remains a development preview with unstable state and interfaces.
- The source checkout remains only a transport for `git archive` of an immutable SHA.
- The Phase 0 Linux/arm64 source build compiled the static-musl launcher and assembled a production runtime closure, including an explicit repair for DSH's incomplete peer-dependency deploy closure.
- The DSH CLI whole-application shutdown timeout remains five seconds.
- The current DSH default profile still permits reads and networking more broadly than workspace writes.
- DSH Web still requires an explicitly configured provider credential for real model use.
- DSH home state still includes settings, credentials, and sessions that require per-instance persistence.

## Primary references

- Apple Container repository: <https://github.com/apple/container>
- Apple Container 1.2.2 release: <https://github.com/apple/container/releases/tag/1.2.2>
- Apple Container 1.2.2 command reference: <https://github.com/apple/container/blob/1.2.2/docs/command-reference.md>
- Apple Container 1.2.2 how-to: <https://github.com/apple/container/blob/1.2.2/docs/how-to.md>
- Colima documentation: <https://colima.run/>
- Zed worktree trust and Restricted Mode: <https://zed.dev/docs/worktree-trust>
- DSH repository documentation and source at the selected immutable commit: <https://github.com/deepseek-ai/deepseek-harness>

## Fresh-session starting checklist

Before implementation, the new session should:

1. Read this entire file.
2. Revalidate every item in "Assumptions requiring revalidation."
3. Inspect the exact DSH build, Web UI, state, telemetry, and shutdown paths at the selected commit.
4. Confirm current Apple Container commands from the exact installed release's primary sources.
5. Run and document both mandatory feasibility spikes before creating the manager skeleton.
6. Present any material contradiction or security limitation before changing the architecture.
7. Create a concrete implementation plan and tests mapped to the acceptance criteria above.
8. Keep manager code, state, and workspaces under their explicitly configured roots unless the user expands scope.
9. Do not modify the trusted DSH source checkout as part of the container-manager implementation unless a separately reviewed DSH change becomes necessary.
