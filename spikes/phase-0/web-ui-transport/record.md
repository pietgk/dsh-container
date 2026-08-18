# Spike A execution record

Date: 2026-08-17

Status: original architecture FAIL; amended exec-stream candidate PASS and accepted on 2026-08-17.

## Original design and failure

The planned path was:

```text
Mac browser -> 127.0.0.1 TCP proxy -> Apple published Unix socket
            -> guest owner-only Unix socket -> guest 127.0.0.1 DSH Web
```

Apple Container 1.2.2 accepted `host_path:container_path` and created the Mac socket. Its vminitd relay resolves the guest source beneath `/run/container/<id>/rootfs/<socket-path>`. A socket created at `/tmp/dsh-web.sock` on tmpfs was invisible there. Repeating the test at `/state/dsh-web.sock` on a named volume produced the same result. The host socket existed but connections reset, and boot logs reported `No such file or directory` for the relay-visible rootfs path.

A read-only rootfs cannot create a socket in the view the Apple relay can see. Making the rootfs writable would weaken a required security invariant. The original architecture therefore fails.

Source correlation used Apple Container tag `1.2.2` at commit `0190097d06df0b9065f4c2d2c7873c649d81d493` and Containerization `0.40.1` at commit `7800b4642171561c95b5f55500b19e5dce5acd45`.

## Amended candidate

The passing path was:

```text
Mac browser -> host-proxy-exec on 127.0.0.1:30080
            -> interactive `container exec` byte stream
            -> Node guest connector -> DSH 127.0.0.1:3080
```

`host-proxy-exec.mjs` SHA-256: `5fba1f6a79073c3c779d19f9818dbd3c20e45cc7ed17587a38dc279a8d956231`.

The candidate uses no guest interface listener, Apple published port, or Apple published socket. DSH keeps its supported guest `127.0.0.1` bind and exact Mac authority in `--trusted-host`.

## Passing evidence

- The public Mac URL served the complete built frontend.
- A full browser load completed with 82 assets and at least 34 fetch or API requests returning `200`.
- The current DSH event channel is a WebSocket. `ws://127.0.0.1:30080/api/events.host` opened successfully.
- A persisted `/workspace` session was visible through the UI.
- Direct guest IPv4 and IPv6 connections to port 3080 both returned connection refused.
- `lsof` showed only `127.0.0.1:30080`; there was no non-loopback Mac listener.
- `container inspect` showed no published ports and no published sockets.
- An allowed Host authority reached the API and an untrusted authority returned `403`.
- Closing child stdin instead of forwarding a signal avoided Apple XPC `missing signal` errors. The proxy then stopped cleanly with exit code 0.
- Graceful container stop, restart, state persistence, and fresh-page recovery worked through the candidate path.

The browser automation surface was unavailable when the final atlas was refreshed, so the review artifact does not claim a new screenshot. The protocol and browser measurements above were recorded during the spike.

## Cost and required follow-up

The measured page used about eight persistent exec connections and the container reached roughly 79 processes during the browser load. The architecture therefore needs explicit ownership and accounting for every accepted connection and child process.

Before the vertical slice is accepted, test:

- concurrent browser connections and connection churn
- WebSocket reconnect and page reload recovery
- proxy crash, manager stop, container stop, and Apple service interruption
- child-stdin closure, exit accounting, timeouts, and leak-free reaping
- bounded behavior under `nproc` and `nofile` limits

## Decision

The user accepted this candidate and the mandatory pinned custom Landlock kernel on 2026-08-17. The decision prefers the stronger read-only-root and guest-loopback invariants while accepting a more unusual host transport with one exec stream per TCP connection. The Phase 1 ownership work and Phase 2 lifecycle and load tests remain mandatory.
