# Landlock kernel artifact provenance

Release asset: `vmlinux-arm64`

- release tag: `kernel-6.18.5-landlock.1`
- target: Apple Container on Linux arm64
- runtime identity: `6.18.5-cz-7800b4642171`
- Apple Containerization source revision:
  `7800b4642171561c95b5f55500b19e5dce5acd45`
- kernel SHA-256:
  `5ac12b28ec01f5ed89f4a6397a29a422b3e615f2b382d8ec328991b1a3953d1b`
- Landlock patch SHA-256:
  `6a2f03ca5c2e5d9f17f389a7f0c1a7438b4c77c579b67345ad7a3056751712fb`

The artifact was built by applying `landlock.patch` to the kernel recipe from
Apple Containerization 0.40.1 and running that recipe's `make` target. The
runtime identity, artifact digest, and Landlock denial probe were verified in
Phase 0.

This record establishes immutable artifact identity and source revision. It is
not yet a fully reproducible build attestation: the complete builder image,
toolchain closure, upstream kernel source digest, and generated configuration
digest are not all captured. The repository must not claim reproducible kernel
build provenance until those inputs are recorded and independently rebuilt.
