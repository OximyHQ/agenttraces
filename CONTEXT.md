# AgentTraces Domain

AgentTraces preserves coding-agent work so people and teams can retrieve, understand, and share it without losing provenance or access controls.

## Identity and teams

**Account**:
An authenticated human identity that can own personal traces and belong to teams.
_Avoid_: User account, principal

**Team**:
The collaboration, policy, and ownership boundary for work repositories and their traces.
_Avoid_: Organization, workspace, namespace

**Membership**:
An account's owner, admin, or member role in a team.
_Avoid_: Seat, team user

**Device**:
One registered AgentTraces installation with its own cryptographic identity and capture health.
_Avoid_: Agent, member, machine user

Claiming a second device with the same verified email merges its anonymous ownership and memberships into the existing account while preserving device, trace, and personal-history identifiers.

**Setup Link**:
A revocable, expiring capability that can admit accounts and devices into a team under owner-defined restrictions.
_Avoid_: Invite code, enrollment token

## Captured work

**Trace**:
One top-level coding-agent session, including its source, author, repository context, usage, and ordered events.
_Avoid_: Chat, conversation, run

**Child Trace**:
A separately inspectable sub-agent session connected to the trace that invoked it.
_Avoid_: Nested message, agent member

**Event**:
One normalized, addressable item in a trace, such as a message, tool operation, command, file action, web request, usage record, or lifecycle change.
_Avoid_: Log line, message

**Operation**:
A paired tool call and result with a semantic kind, status, purpose, duration, and optional child trace.
_Avoid_: Tool message, raw call

**Pull Request Link**:
A many-to-many relationship between a trace and a pull request, carrying the evidence and confidence that produced the link.
_Avoid_: PR field, inferred association

**Cost Accuracy**:
The provenance of a usage cost: exact, estimated, subscription-included, or unavailable.
_Avoid_: Cost estimate without qualification

## Access and sharing

**Team Repository**:
A repository selected by a team owner for team-owned capture; traces produced there are accessible to team owners and admins.
_Avoid_: Shared repository

**Share**:
A revocable capability that exposes an immutable trace snapshot with a specific content view, audience, and expiry.
_Avoid_: Public trace, visibility toggle

**Overview**:
A trace view containing its generated title, structured summary, outcome, metadata, and representative evidence.
_Avoid_: Highlights

**Conversation View**:
A trace view containing user and assistant messages while operations remain hidden or collapsed.
_Avoid_: Base transcript

**Full Trace View**:
A trace view containing every permitted normalized event and operation.
_Avoid_: Raw transcript

**Public Share**:
A share intentionally made discoverable; an unlisted link is not public merely because anyone holding it can open it.
_Avoid_: Direct link

The public route includes a readable title slug for recognition and link previews. The opaque capability token remains the only authority; changing or omitting the slug does not change access.
