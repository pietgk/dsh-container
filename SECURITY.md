# Security policy

This project is an evaluation manager, not a multi-user security boundary.
Version 1 intentionally permits unrestricted guest egress and gives the guest
write access to the exact bind-mounted workspace after explicit acknowledgement.
Other local macOS users are outside the reviewed threat model.

Report vulnerabilities through a private GitHub security advisory for
`pietgk/dsh-container`. Do not include provider keys, session transcripts, or
other secrets in a public issue.

The reviewed runtime requires the exact pinned DSH image and Landlock-capable
kernel. A digest mismatch, missing confinement control, writable root
filesystem, or unexpected network publication must fail initialization rather
than silently weaken the profile.
