const express = require("express");
const router = express.Router();
const dayjs = require("dayjs");
const { jobs, shippers, carriers, drivers, customers } = require("./mockdata");
const {
  formatDueDate,
  formatAcceptDeadline,
  getDeadlineTier,
  getSmartMatchLevel,
  getApprovalStatus,
  paginate,
  ok,
  err,
  resolveCustomer,
  formatCreatedAt,
} = require("./helpers");

// Statuses visible in Inbound Approvals
const INBOUND_STATUSES = [
  "PENDING_CARRIER",
  "PENDING_DRIVER",
  "DRIVER_ASSIGNED",
  "CONFIRMED",
  "COMPLETED",
  "REJECTED_ADMIN",
  "REJECTED_DRIVER",
];

function buildInboundRow(job) {
  const shipper = shippers.find((s) => s.id === job.shipper_id);
  const approvalStatus = getApprovalStatus(job.backend_status);
  const deadline = formatAcceptDeadline(job.accept_deadline);
  const tier = getDeadlineTier(job.accept_deadline);
  return {
    job_id: job.id,
    approval_status: approvalStatus,
    shipper: shipper?.name ?? null,
    pickup_due: formatDueDate(job.pickup_due),
    delivery_due: formatDueDate(job.delivery_due),
    accept_deadline: deadline,
    accept_deadline_tier: tier,
    origin: job.origin,
    destination: job.destination,
    price: job.price,
    price_currency: "THB",
    smart_match: {
      percentage: job.smart_match_pct,
      level: getSmartMatchLevel(job.smart_match_pct),
      driver_count: job.smart_match_drivers,
      label:
        job.smart_match_drivers === 1
          ? "1 driver"
          : `${job.smart_match_drivers} drivers`,
    },
  };
}

// ------------------------------------------------------------------
// GET /inbound-approvals
// Query: approval_status, pickup_date_from, pickup_date_to,
//        delivery_date_from, delivery_date_to, shipper, customer,
//        origin, deadline_tier, job_status, search (job_id), page, limit
// ------------------------------------------------------------------
router.get("/", (req, res) => {
  let list = jobs.filter((j) => INBOUND_STATUSES.includes(j.backend_status));

  if (req.query.company_id) {
    list = list.filter((j) => j.carrier_id === req.query.company_id);
  }

  // filter by approval_status
  if (req.query.approval_status) {
    list = list.filter(
      (j) => getApprovalStatus(j.backend_status) === req.query.approval_status,
    );
  }

  // search by job_id
  if (req.query.search) {
    list = list.filter((j) =>
      j.id.toLowerCase().includes(req.query.search.toLowerCase()),
    );
  }

  // filter by shipper name
  if (req.query.shipper) {
    const s = shippers.find((x) =>
      x.name.toLowerCase().includes(req.query.shipper.toLowerCase()),
    );
    if (s) list = list.filter((j) => j.shipper_id === s.id);
  }

  // filter pickup date range
  if (req.query.pickup_date_from) {
    list = list.filter(
      (j) =>
        j.pickup_due &&
        dayjs(j.pickup_due).isAfter(
          dayjs(req.query.pickup_date_from).subtract(1, "ms"),
        ),
    );
  }
  if (req.query.pickup_date_to) {
    list = list.filter(
      (j) =>
        j.pickup_due &&
        dayjs(j.pickup_due).isBefore(
          dayjs(req.query.pickup_date_to).add(1, "day"),
        ),
    );
  }

  // filter deadline tier
  if (req.query.deadline_tier) {
    list = list.filter(
      (j) => getDeadlineTier(j.accept_deadline) === req.query.deadline_tier,
    );
  }

  // filter job_status
  if (req.query.job_status) {
    list = list.filter((j) => j.job_status === req.query.job_status);
  }

  // priority sort: PENDING > APPROVED > IN_PROGRESS > COMPLETED > REJECTED
  const priorityOrder = [
    "PENDING",
    "APPROVED",
    "IN_PROGRESS",
    "COMPLETED",
    "REJECTED",
  ];
  list.sort((a, b) => {
    const pa = priorityOrder.indexOf(getApprovalStatus(a.backend_status));
    const pb = priorityOrder.indexOf(getApprovalStatus(b.backend_status));
    return pa - pb;
  });

  let baseList = jobs.filter((j) =>
    INBOUND_STATUSES.includes(j.backend_status),
  );
  if (req.query.company_id) {
    baseList = baseList.filter((j) => j.carrier_id === req.query.company_id);
  }
  const summary = {
    all: baseList.length,
    pending: baseList.filter(
      (j) => getApprovalStatus(j.backend_status) === "PENDING",
    ).length,
    approved: baseList.filter(
      (j) => getApprovalStatus(j.backend_status) === "APPROVED",
    ).length,
    in_progress: baseList.filter(
      (j) => getApprovalStatus(j.backend_status) === "IN_PROGRESS",
    ).length,
    completed: baseList.filter(
      (j) => getApprovalStatus(j.backend_status) === "COMPLETED",
    ).length,
    rejected: baseList.filter(
      (j) => getApprovalStatus(j.backend_status) === "REJECTED",
    ).length,
  };

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const paged = paginate(list.map(buildInboundRow), page, limit);

  ok(res, paged.data, {
    summary,
    pagination: {
      total: paged.total,
      page: paged.page,
      limit: paged.limit,
      total_pages: paged.total_pages,
    },
  });
});

// ------------------------------------------------------------------
// GET /inbound-approvals/:jobId   — job detail + drivers tab snapshot
// ------------------------------------------------------------------
router.get("/:jobId", (req, res) => {
  const job = jobs.find(
    (j) =>
      j.id === req.params.jobId && INBOUND_STATUSES.includes(j.backend_status),
  );
  if (!job) return err(res, 404, "Job not found in Inbound Approvals");

  const shipper = shippers.find((s) => s.id === job.shipper_id);
  const carrier = carriers.find((c) => c.id === job.carrier_id);
  const driver = drivers.find((d) => d.id === job.driver_id);

  ok(res, {
    job_id: job.id,
    approval_status: getApprovalStatus(job.backend_status),
    backend_status: job.backend_status,
    job_details: {
      customer: resolveCustomer(job.customer_id, customers),
      created_at: formatCreatedAt(job.created_at),
      carrier: carrier?.name ?? null,
      driver: driver?.name ?? "Awaiting Carrier Assignment",
      remark: job.remark,
      pickup: job.pickup_point,
      delivery: job.delivery_point,
      items: job.items,
      total_weight_kg: job.total_weight_kg,
      total_volume_cbm: job.total_volume_cbm,
    },
    summary: {
      vehicle_type: job.vehicle_type_required,
      distance_km: job.distance_km,
      est_eta_hrs: job.est_eta_hrs,
      weight_kg: job.total_weight_kg,
      volume_cbm: job.total_volume_cbm,
      total_items: job.total_items,
      marketplace_price: job.price,
      price_currency: "THB",
    },
    job_history: job.job_history,
  });
});

// ------------------------------------------------------------------
// POST /inbound-approvals/approve
// Body: { job_ids: string[], admin_name?: string }
// ทั้ง single และ bulk ใช้เส้นเดียวกัน
// ------------------------------------------------------------------
router.post("/approve", (req, res) => {
  const { job_ids, admin_name } = req.body;

  // validate
  if (!job_ids || !Array.isArray(job_ids) || job_ids.length === 0)
    return err(res, 400, "job_ids array is required");

  const results = job_ids.map((id) => {
    const job = jobs.find((j) => j.id === id);
    if (!job) return { job_id: id, success: false, message: "Job not found" };
    if (job.backend_status !== "PENDING_CARRIER")
      return {
        job_id: id,
        success: false,
        message: `Cannot approve job in status: ${job.backend_status}`,
      };

    job.backend_status = "PENDING_DRIVER";
    job.job_history.push({
      date_time: dayjs().toISOString(),
      event: "Approved",
      actor: `[Admin] ${admin_name || "Admin"}`,
      target: null,
      reason: null,
    });
    return {
      job_id: id,
      success: true,
      new_status: "PENDING_DRIVER",
      approval_status: "APPROVED",
    };
  });

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.filter((r) => !r.success).length;

  ok(res, results, {
    message: `Approved ${successCount} job(s) successfully${failCount > 0 ? `, ${failCount} failed` : ""}`,
    summary: {
      success: successCount,
      failed: failCount,
      total: results.length,
    },
  });
});

// ------------------------------------------------------------------
// POST /inbound-approvals/:jobId/reject
// Body: { reason: string, notes?: string, admin_name?: string }
// ------------------------------------------------------------------
router.post("/:jobId/reject", (req, res) => {
  const job = jobs.find((j) => j.id === req.params.jobId);
  if (!job) return err(res, 404, "Job not found");
  if (
    !["PENDING_CARRIER", "PENDING_DRIVER", "DRIVER_ASSIGNED"].includes(
      job.backend_status,
    )
  ) {
    return err(res, 400, `Cannot reject job in status: ${job.backend_status}`);
  }
  if (!req.body.reason) return err(res, 400, "Rejection reason is required");

  job.backend_status = "REJECTED_ADMIN";
  job.carrier_id = null;
  job.driver_id = null;
  job.job_history.push({
    date_time: dayjs().toISOString(),
    event: "Admin Rejected",
    actor: `[Admin] ${req.body.admin_name || "Admin"}`,
    target: null,
    reason: req.body.reason,
  });

  ok(
    res,
    {
      job_id: job.id,
      new_status: "REJECTED_ADMIN",
      approval_status: "REJECTED",
    },
    { message: "Job rejected" },
  );
});

module.exports = router;
