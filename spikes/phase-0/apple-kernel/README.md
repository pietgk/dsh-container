# Apple Container Landlock kernel spike

Apple Container 1.2.2's downloaded default arm64 kernel is Linux 6.18.15,
but its `/proc/config.gz` contains `# CONFIG_SECURITY_LANDLOCK is not set`.
The DSH launcher's functional probe therefore fails with `ENOSYS`.

The compatibility baseline is Apple `containerization` 0.40.1 at commit
`7800b4642171561c95b5f55500b19e5dce5acd45`, which is the exact dependency
of Apple Container 1.2.2. Apply `landlock.patch`, run `make` in its `kernel/`
directory, and pass the resulting `bin/vmlinux-arm64` to `container run -k`.

The upstream kernel recipe pins Linux 6.18.5. Keep the kernel version, source
URL, source digest, config digest, patch digest, and built-image digest in the
Spike B record. The manager must treat this kernel as a pinned immutable input,
not as mutable host configuration.
