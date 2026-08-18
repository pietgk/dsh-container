# Spike A: Web UI transport

The originally planned Apple published-socket transport failed on Apple Container 1.2.2 when combined with a read-only root filesystem. `host-proxy.mjs` is retained as the exact failed experiment. It must not be used as the version 1 architecture.

`host-proxy-exec.mjs` is the candidate replacement. It binds only Mac `127.0.0.1`, opens one interactive `container exec` byte stream for each accepted TCP connection, and connects inside the guest to DSH on `127.0.0.1:3080`. The container publishes no TCP ports or Unix sockets.

The candidate preserves read-only rootfs and guest-loopback isolation. Its main cost is one manager-owned exec child per browser TCP connection, so lifecycle ownership, load, reconnection, and cleanup are mandatory Phase 1 and Phase 2 test areas.

See `record.md` for the failure evidence, successful measurements, and the architecture decision gate.
