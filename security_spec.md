# Security Specification — Helpdesk Proactif & SLA

## 1. Data Invariants
1. **Authentication & Email Verification**: All reads and writes require an authenticated Firebase user with `request.auth.token.email_verified == true`.
2. **Workspace Isolation & Ownership**: Every top-level operational document (`agents`, `clients`, `slaPolicies`, `tickets`, `onCallShifts`, `agentLeaves`, `automationRules`, `callLogs`, `kbArticles`, `forumTopics`, `csatSurveys`, `qaEvaluations`, `wfmShifts`, `integrations`, `workspaceConfigs`, `auditLogs`) binds `ownerId == request.auth.uid` on creation and forbids changing `ownerId` on update. List queries require `resource.data.ownerId == request.auth.uid || request.auth.uid in resource.data.memberIds || isAdmin()`.
3. **Master Gate Subcollection Sync**: `tickets/{ticketId}/events/{eventId}` verifies parent `/tickets/{ticketId}` existence and membership on `get`, `create`, `update`, and `delete`, while `list` inspects `resource.data` directly without `get()`.
4. **PII Split Collection & RGPD**: `users/{userId}/private/info` is readable/writable strictly by `request.auth.uid == userId` or `isAdmin()`. Public profile at `users/{userId}/public/profile` excludes email/phone and forbids self-escalating `role` to `admin` unless `isAdmin()`. `auditLogs` entries are immutable (`allow update: if false`).
5. **Immutable Temporal Integrity**: `createdAt` must equal `request.time` on create and remain identical on update; `updatedAt` must equal `request.time` on create and update.
6. **Bounded Arrays & String Limits**: Every string checks `.size() <= MAX`; `tags`, permission lists, and `memberIds` arrays are capped (`<= 10`, `<= 12`, and `<= 20`) and validated.

## 2. Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Identity Spoofing on Ticket Create**: `{ ownerId: "other_uid", ... }` -> Rejected (`incoming().ownerId == request.auth.uid`).
2. **Shadow Field Injection on Ticket Create**: `{ ..., isSystemVerified: true }` -> Rejected (`hasOnly([...])`).
3. **Role Self-Escalation on User Profile**: `users/{uid}/public/profile` with `{ role: "admin" }` by non-admin -> Rejected.
4. **Unverified Email Write**: Auth token with `email_verified: false` -> Rejected (`isVerified()`).
5. **Client Timestamp Forgery**: `{ createdAt: "2020-01-01T00:00:00Z" }` -> Rejected (`createdAt == request.time`).
6. **ID Poisoning**: Document ID of 300 characters or containing `../` -> Rejected (`isValidId()`).
7. **Orphaned Ticket Event**: Writing `/tickets/nonexistent_id/events/evt1` -> Rejected (`exists(/databases/$(database)/documents/tickets/$(ticketId))`).
8. **Cross-Tenant List Scraping**: Querying `tickets` without filtering to `ownerId == uid` -> Rejected (`allow list` enforces `resource.data`).
9. **PII Leak Attempt**: Non-owner reading `/users/{otherUid}/private/info` -> Rejected.
10. **Terminal State Tampering**: Non-admin modifying a `closed` ticket back to `open` without admin override or altering `ownerId` -> Rejected.
11. **Unbounded Array DoS**: `tags` array with 50 items -> Rejected (`tags.size() <= 10`).
12. **Type Poisoning on Update**: Updating `firstResponseDueMs` to a string `"soon"` -> Rejected (`isValidTicket` validates `int`).
