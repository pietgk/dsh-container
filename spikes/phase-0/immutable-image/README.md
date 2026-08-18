# Spike B: immutable source image

This spike builds DSH `0.1.0-rc.7` from exact official commit
`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca` for Linux arm64.

The build context is assembled from `git archive` plus the two reviewed
spike-owned files in this directory. The live checkout is never passed to the
image builder.

Pinned Node base:

```text
docker.io/library/node@sha256:af01d58b748ec92b1d6e8e11429aad424fd1e68c848185399dca0596a1ab8f5c
```

This is the Linux arm64 manifest of `node:24.18.0-bookworm-slim`. The
multi-platform index observed during selection was
`sha256:6f7b03f7c2c8e2e784dcf9295400527b9b1270fd37b7e9a7285cf83b6951452d`.

The image includes a spike-owned Node supervisor. It starts DSH on guest
`127.0.0.1:3080`, forwards termination signals, and reaps through Apple
Container's `--init` process. It also retains the guest Unix-socket bridge
used to prove that Apple `--publish-socket` cannot see sockets on tmpfs or
named volumes under a read-only rootfs. That bridge is not the proposed
version 1 host transport; see the Spike A record for the exec-stream
replacement.

The authoritative identities and results are recorded in `record.md`.
