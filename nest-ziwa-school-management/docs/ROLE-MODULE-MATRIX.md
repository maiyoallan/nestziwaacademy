# Roles and module access (initial policy)

| Role | Intended access |
|---|---|
| SYSTEM_ADMIN | All modules, users, settings and audit logs |
| HEADTEACHER | School overview, students, academics, attendance, staff, reports, announcements |
| BURSAR | Fees, invoices, payments, expenses, finance reports |
| TEACHER | Assigned classes, attendance, assessments, results, announcements |
| ADMISSIONS | Applicants, student registration, guardians and enrolments |
| STOREKEEPER | Inventory, suppliers and purchases |
| TRANSPORT_MANAGER | Vehicles, routes, transport records |
| DRIVER | Assigned vehicle/route information only (dedicated assignment workflow still to be added) |
| PARENT | Own linked learner records, balances, attendance and results (portal linking workflow still to be completed) |
| STUDENT | Own profile, timetable, attendance and results (self-service scoping still to be completed) |

The API currently enforces module-level role permissions. Before production, add row-level scoping so parents, students, teachers and drivers can only access records specifically linked to them. Do not expose the API publicly until this is implemented and tested.
