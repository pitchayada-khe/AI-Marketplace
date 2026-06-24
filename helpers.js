const dayjs = require("dayjs");

function resolveCustomer(customerId, customers) {
  return customers.find((c) => c.id === customerId)?.name ?? null;
}

function formatCreatedAt(iso) {
  return dayjs(iso).format("YYYY-MM-DD hh:mm A");
}

// Format PICKUP DUE / DELIVERY DUE: Today / Tomorrow / DD MMM YY, HH:mm
function formatDueDate(isoString) {
  if (!isoString) return null;
  const d = dayjs(isoString);
  const now = dayjs();
  if (d.isSame(now, "day")) return `Today, ${d.format("HH:mm")}`;
  if (d.isSame(now.add(1, "day"), "day"))
    return `Tomorrow, ${d.format("HH:mm")}`;
  return d.format("DD MMM YY, HH:mm");
}

// Accept Deadline countdown
function formatAcceptDeadline(isoString) {
  if (!isoString) return null;
  const deadline = dayjs(isoString);
  const now = dayjs();
  const minsLeft = deadline.diff(now, "minute");
  if (minsLeft <= 0) return `${deadline.format("HH:mm")} (0m left)`;
  return `${deadline.format("HH:mm")} (${minsLeft}m left)`;
}

// SLA tier
function getDeadlineTier(isoString) {
  if (!isoString) return null;
  const minsLeft = dayjs(isoString).diff(dayjs(), "minute");
  if (minsLeft > 30) return "safe";
  if (minsLeft > 15) return "warning";
  return "critical";
}

// Smart match color
function getSmartMatchLevel(pct) {
  if (pct === null || pct === undefined) return null;
  if (pct >= 80) return "high";
  if (pct >= 60) return "medium";
  return "low";
}

// Approval status from backend status (Inbound view)
function getApprovalStatus(backendStatus) {
  const map = {
    PENDING_CARRIER: "PENDING",
    PENDING_DRIVER: "APPROVED",
    DRIVER_ASSIGNED: "APPROVED",
    CONFIRMED: "IN_PROGRESS",
    COMPLETED: "COMPLETED",
    REJECTED_ADMIN: "REJECTED",
    REJECTED_DRIVER: "APPROVED",
    TIMEOUT: null,
    RETURNED_TO_POD: null,
  };
  return map[backendStatus] ?? null;
}

// Assign status (Driver Assignments view)
function getAssignStatus(backendStatus, driverRejected = false) {
  if (driverRejected) return "UNASSIGNED_ALERT";
  const map = {
    PENDING_DRIVER: "UNASSIGNED",
    DRIVER_ASSIGNED: "ASSIGNED",
    CONFIRMED: "ACCEPTED",
    COMPLETED: "ACCEPTED",
    REJECTED_DRIVER: "UNASSIGNED_ALERT",
  };
  return map[backendStatus] ?? "UNASSIGNED";
}

// Transfer status (Outbound view)
function getTransferStatus(backendStatus) {
  const map = {
    DRAFT: "DRAFT",
    UNASSIGNED: "UNASSIGNED",
    PENDING_CARRIER: "PENDING_CARRIER",
    PENDING_DRIVER: "PENDING_DRIVER",
    DRIVER_ASSIGNED: "PENDING_DRIVER",
    CONFIRMED: "CONFIRMED",
    COMPLETED: "COMPLETED",
    REJECTED_ADMIN: "UNASSIGNED_ALERT",
    TIMEOUT: "UNASSIGNED_ALERT",
    RETURNED_TO_POD: null,
  };
  return map[backendStatus] ?? null;
}

// pagination helper
function paginate(arr, page = 1, limit = 10) {
  const total = arr.length;
  const start = (page - 1) * limit;
  const data = arr.slice(start, start + limit);
  return {
    data,
    total,
    page: Number(page),
    limit: Number(limit),
    total_pages: Math.ceil(total / limit),
  };
}

// success response
function ok(res, data, meta = {}) {
  return res.json({ success: true, ...meta, data });
}

// error response
function err(res, status, message) {
  return res.status(status).json({ success: false, message });
}

module.exports = {
  formatDueDate,
  formatAcceptDeadline,
  getDeadlineTier,
  getSmartMatchLevel,
  getApprovalStatus,
  getAssignStatus,
  getTransferStatus,
  paginate,
  ok,
  err,
  resolveCustomer,
  formatCreatedAt,
};
