# Evaluation gap register

This register distinguishes acceptance debt from intentionally deferred product
work. GitHub issues are the execution backlog; the accepted specification and
phase records remain the evidence source.

| Gap | Disposition | Trigger or acceptance condition |
| --- | --- | --- |
| Automated and interactive transcript review | Acceptance debt, P1 | Playwright passes at both viewports; official Browser state is recorded separately |
| Selective persistent deletion | Acceptance debt, P1 | Exact state, cache, network, and workspace targets are previewed, confirmed, and tested |
| Apple service interruption recovery | Acceptance debt, P1 | No orphan exec children; reconciliation restores or clearly diagnoses the instance |
| CPU, memory, and shutdown evidence | Acceptance debt, P1 | Functional throttling and OOM tests plus ready/stop metadata fields pass |
| One exec process per connection | Product hardening, P2 | Replace before multi-user or product-scale use |
| Volume workspace and backups | Deferred trigger, P2 | Implement before untrusted repositories or parallel autonomous jobs |
| Restricted provider egress | Deferred trigger, P2 | Prove DNS and direct-IP bypass resistance before claiming restriction |
| Local multi-user Web boundary | Deferred trigger, P2 | Implement before broadening the single-user threat model |
| Kernel and release provenance | Product hardening, P2 | Reproducible recipe and signed release policy are captured |
| DSH dependency audit | Recurring gate, P1 | Re-run for every pinned DSH source or image revision |
| DSH form-field accessibility warning | Upstream | Track in DSH; this manager does not own the Web frontend |
| Colima or E2B backend | Decision trigger | Revisit only for remote execution, multi-user service, or stronger cloud disposal |

Closed evidence includes the host-native comparison, four real-model scenarios,
repeat persistence, default cleanup, proxy recovery, overload admission cap,
idle keep-alive fix, and controlled ready-time resource snapshot.
