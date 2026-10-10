# TicketDesk

A helpdesk ticket tracker with two sides: Requesters, who raise Tickets, and Staff, who triage, assign, progress, and close them.

## Language

**Ticket**:
A single request for help raised by a Requester.
_Avoid_: issue, case, request, task, job

**Requester**:
The User who raised a Ticket. Every Ticket has exactly one, fixed at creation.
_Avoid_: customer, client, reporter, submitter, owner

**Staff**:
A User whose Role is STAFF. Staff reach every Ticket regardless of who raised it.
_Avoid_: agent, admin, support rep, operator

**Role**:
Which side of the desk a User sits on: USER or STAFF. Set when the account is created and never changed by the application.
_Avoid_: type, kind, permission level

**Status**:
Where a Ticket sits in its life: `open`, `in-progress`, `resolved`, or `closed`. Only Staff move it.
_Avoid_: state, stage, phase, progress

**Priority**:
How urgent a Ticket is: `low`, `medium`, or `high`. The Requester sets it when raising the Ticket; only Staff change it afterwards.
_Avoid_: severity, urgency, importance, weight

**Comment**:
A message posted to a Ticket's thread by its Requester or by Staff. Written once, never altered.
_Avoid_: reply, message, note, post, update

**Status Change**:
A record that a Ticket moved from one Status to another — who moved it, when, and why. The audit trail of a Ticket's life; a Ticket's creation is not one.
_Avoid_: transition, event, history entry, log entry, audit record

**Assignee**:
The Staff member a Ticket is assigned to. At most one per Ticket, and a Ticket need not have one.
_Avoid_: owner, handler, agent, responsible party
