# Spike B execution record

Date: 2026-08-17

Status: PASS and accepted for evaluation on 2026-08-17.

## Immutable inputs and artifacts

- DSH remote: `https://github.com/deepseek-ai/deepseek-harness.git`
- DSH SHA: `99f6f02fecdb7dff40c3fbc9470f5907c29f74ca`
- DSH tag and version: `dsh-v0.1.0-rc.7`, `0.1.0-rc.7`
- DSH source archive SHA-256: `0eaadd304b81532ea14f8d3c4d96499d91a80c4356eed4e839c951ca04dc6aa8`
- pnpm: `11.7.0`, selected by the archived repository manifest
- pnpm lockfile SHA-256: `f517dc3978d57531cda747df62a2abdde1df5b9f25415fcf1fc5d51f8b7547ea`
- Node base, Linux arm64: `docker.io/library/node@sha256:af01d58b748ec92b1d6e8e11429aad424fd1e68c848185399dca0596a1ab8f5c`
- Containerfile SHA-256: `41322b6fa946f437765d7e5c20b417387ff68847e726fa262524c24ec353298a`
- Supervisor SHA-256: `5b4c792197c25ed248c081493c975559204c324f83c5d0a9d8ec6175019b4815`
- OCI index digest: `sha256:a9f384b239d75d6aca3448a7bb4ead0d6697fb9271e4b46b78849254dd4afc39`
- Linux arm64 manifest digest: `sha256:2408a8e0d8c41ecbe1e1e268785a0f221aef5a9e12d4ef0ceb9db1ef0c8e818d`
- Image tags: `dsh-spike-b:99f6f02` and `dsh-spike-b:99f6f02-v5`
- Apple Container CLI and API server: `1.2.2`
- Custom runtime kernel: Linux `6.18.5-cz-7800b4642171`
- Kernel SHA-256: `5ac12b28ec01f5ed89f4a6397a29a422b3e615f2b382d8ec328991b1a3953d1b`
- Landlock patch SHA-256: `6a2f03ca5c2e5d9f17f389a7f0c1a7438b4c77c579b67345ad7a3056751712fb`

The image build context was assembled from `git archive` plus the reviewed spike-owned `Containerfile` and supervisor. The live checkout, `.git`, ignored files, untracked files, `.env`, credentials, and host `node_modules` were not sent to the builder.

## Build result

The frozen install, static Linux arm64 `landlock-run` build, TypeScript faces, `tsdown` output, and Vite Web frontend all built successfully. The final image contains no compiler, Python, musl toolchain, build cache, source-control metadata, registry credentials, or symlinks back to `/src`.

The upstream DSH production deploy was not a complete Web runtime closure. Its pnpm isolated graph omitted peer-only packages, and DSH's flat-profile healer could not discover those dependencies. The reviewed image repair builds a CLI production deploy, an SDK runtime deploy, and four exact peer-only package deploys, then materializes a self-contained flat runtime closure under `/opt`. This is a DSH packaging workaround, not an ambient registry install.

## Functional security proofs

The exact image ran under Apple Container with:

- runtime UID and GID `1000:1000`
- read-only root filesystem
- all effective Linux capabilities dropped
- CPU `2`, memory `2048 MB`, `nofile` `1024`, and `nproc` `512`
- exact writable paths `/workspace`, `/state`, `/cache`, and `/tmp`
- denied writes to `/opt`, `/etc`, `/root`, and `/var/tmp`
- read-only `/workspace/.git` overmount
- no host credential or environment inheritance; a `/workspace/.env` sentinel was not loaded
- unrestricted outbound DNS and IP connectivity, as declared for version 1
- host ownership mapping for workspace writes
- persistent state and cache volumes; non-persistent tmpfs
- the pinned custom Apple kernel with a functional Landlock denial probe

Apple's downloaded default kernel has `CONFIG_SECURITY_LANDLOCK` disabled and returns `ENOSYS`. The custom kernel is therefore a mandatory Apple backend component, not an optional hardening improvement.

## DSH lifecycle proofs

- DSH served the built frontend from guest `127.0.0.1:3080`.
- An allowed Host authority reached the API; an untrusted Host authority returned `403`.
- A workspace identity was registered at `/workspace`.
- A controlled session persisted with cwd `/workspace`, title `Spike B workspace session`, and preset `minimal`.
- A Landlock-constrained shell wrote `/workspace/dsh-spike-shell.txt` and failed to write `/etc`.
- Graceful stop and restart succeeded; session, state, and cache persisted.

## Audit acknowledgement

The production audit covered 437 dependencies and reported 0 critical, 12 high, 12 moderate, and 1 low finding. The user explicitly acknowledged the 12 high and 12 moderate findings for this evaluation build on 2026-08-17. This acceptance is limited to the controlled evaluation and does not waive future audit gates for another DSH revision or image build.
