const express = require("express");
const router = express.Router();
const dayjs = require("dayjs");
const { jobs, drivers, shippers, carriers, customers } = require("./mockdata");
const {
  formatDueDate,
  formatAcceptDeadline,
  getDeadlineTier,
  getSmartMatchLevel,
  getAssignStatus,
  paginate,
  ok,
  err,
  resolveCustomer,
  formatCreatedAt,
} = require("./helpers");

const DRIVER_ASSIGN_STATUSES = [
  "PENDING_DRIVER",
  "DRIVER_ASSIGNED",
  "CONFIRMED",
  "COMPLETED",
  "REJECTED_DRIVER",
];

function buildAssignRow(job) {
  const shipper = shippers.find((s) => s.id === job.shipper_id);
  const driver = drivers.find((d) => d.id === job.driver_id);
  const assignStatus = getAssignStatus(job.backend_status);
  return {
    job_id: job.id,
    assign_status: assignStatus,
    job_status: job.job_status,
    shipper: shipper?.name ?? null,
    pickup_due: formatDueDate(job.pickup_due),
    delivery_due: formatDueDate(job.delivery_due),
    accept_deadline: formatAcceptDeadline(job.accept_deadline),
    accept_deadline_tier: getDeadlineTier(job.accept_deadline),
    origin: job.origin,
    destination: job.destination,
    group_name: driver?.group ?? null,
    driver_name: driver?.name ?? null,
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
// GET /driver-assignments
// Query: assign_status, job_status, shipper, customer, driver_group,
//        deadline_tier, pickup_date_from, pickup_date_to, search, page, limit
// ------------------------------------------------------------------
router.get("/", (req, res) => {
  let list = jobs.filter((j) =>
    DRIVER_ASSIGN_STATUSES.includes(j.backend_status),
  );

  if (req.query.company_id) {
    list = list.filter((j) => j.carrier_id === req.query.company_id);
  }

  if (req.query.assign_status) {
    list = list.filter(
      (j) => getAssignStatus(j.backend_status) === req.query.assign_status,
    );
  }
  if (req.query.job_status) {
    list = list.filter((j) => j.job_status === req.query.job_status);
  }
  if (req.query.search) {
    list = list.filter((j) =>
      j.id.toLowerCase().includes(req.query.search.toLowerCase()),
    );
  }
  if (req.query.shipper) {
    const s = shippers.find((x) =>
      x.name.toLowerCase().includes(req.query.shipper.toLowerCase()),
    );
    if (s) list = list.filter((j) => j.shipper_id === s.id);
  }
  if (req.query.driver_group) {
    list = list.filter((j) => {
      const drv = drivers.find((d) => d.id === j.driver_id);
      return drv?.group
        ?.toLowerCase()
        .includes(req.query.driver_group.toLowerCase());
    });
  }
  if (req.query.deadline_tier) {
    list = list.filter(
      (j) => getDeadlineTier(j.accept_deadline) === req.query.deadline_tier,
    );
  }

  // Priority: ⚠️UNASSIGNED_ALERT → UNASSIGNED → ASSIGNED → ACCEPTED
  const assignPriority = [
    "UNASSIGNED_ALERT",
    "UNASSIGNED",
    "ASSIGNED",
    "ACCEPTED",
  ];
  const jobStatusPriority = ["OPEN", "RECEIVED", "SENT", "COMPLETED"];
  list.sort((a, b) => {
    const pa = assignPriority.indexOf(getAssignStatus(a.backend_status));
    const pb = assignPriority.indexOf(getAssignStatus(b.backend_status));
    if (pa !== pb) return pa - pb;
    // secondary sort by job_status for ACCEPTED items
    return (
      jobStatusPriority.indexOf(a.job_status) -
      jobStatusPriority.indexOf(b.job_status)
    );
  });

  let baseList = jobs.filter((j) =>
    DRIVER_ASSIGN_STATUSES.includes(j.backend_status),
  );
  if (req.query.company_id) {
    baseList = baseList.filter((j) => j.carrier_id === req.query.company_id);
  }
  const summary = {
    all: baseList.length,
    unassigned: baseList.filter((j) =>
      ["UNASSIGNED", "UNASSIGNED_ALERT"].includes(
        getAssignStatus(j.backend_status),
      ),
    ).length,
    assigned: baseList.filter(
      (j) => getAssignStatus(j.backend_status) === "ASSIGNED",
    ).length,
    accepted: baseList.filter(
      (j) => getAssignStatus(j.backend_status) === "ACCEPTED",
    ).length,
  };

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const paged = paginate(list.map(buildAssignRow), page, limit);

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
// GET /driver-assignments/:jobId   — detail + drivers list or assigned driver detail
// ------------------------------------------------------------------
router.get("/:jobId", (req, res) => {
  const job = jobs.find(
    (j) =>
      j.id === req.params.jobId &&
      DRIVER_ASSIGN_STATUSES.includes(j.backend_status),
  );
  if (!job) return err(res, 404, "Job not found in Driver Assignments");

  const shipper = shippers.find((s) => s.id === job.shipper_id);
  const carrier = carriers.find((c) => c.id === job.carrier_id);
  const assignedDriver = drivers.find((d) => d.id === job.driver_id);
  const isAssigned = ["DRIVER_ASSIGNED", "CONFIRMED", "COMPLETED"].includes(
    job.backend_status,
  );
  const timeoutCountdown = job.accept_deadline
    ? formatAcceptDeadline(job.accept_deadline)
    : null;

  // Build assigned driver detail (tab type 2)
  const assignedDriverDetail = assignedDriver
    ? {
        driver_id: assignedDriver.id,
        name: assignedDriver.name,
        photo_url: null,
        group: assignedDriver.group,
        hhid: assignedDriver.hhid,
        plate: assignedDriver.plate,
        vehicle_type: assignedDriver.vehicle_type,
        available_capacity_kg: assignedDriver.available_capacity_kg,
        pending_jobs: assignedDriver.pending_jobs,
        vehicle_specs: assignedDriver.vehicle_specs,
        operational_costs: {
          fuel_type: assignedDriver.fuel_type,
          fuel_cost_per_km: assignedDriver.fuel_cost_per_km,
          fixed_cost_thb: assignedDriver.fixed_cost,
          time_cost_per_min_thb: assignedDriver.time_cost_per_min,
        },
        gps: { lat: assignedDriver.gps_lat, lng: assignedDriver.gps_lng },
        timeout_countdown: timeoutCountdown,
        is_accepted:
          job.backend_status === "CONFIRMED" ||
          job.backend_status === "COMPLETED",
      }
    : null;

  ok(res, {
    job_id: job.id,
    assign_status: getAssignStatus(job.backend_status),
    backend_status: job.backend_status,
    job_details: {
      customer: resolveCustomer(job.customer_id, customers),
      created_at: formatCreatedAt(job.created_at),
      carrier: carrier?.name ?? null,
      driver: assignedDriver?.name ?? "Awaiting Carrier Assignment",
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
// POST /driver-assignments/:jobId/assign
// Body: { driver_id: string, admin_name?: string }
// ------------------------------------------------------------------
router.post("/:jobId/assign", (req, res) => {
  const job = jobs.find((j) => j.id === req.params.jobId);
  if (!job) return err(res, 404, "Job not found");
  if (!["PENDING_DRIVER", "REJECTED_DRIVER"].includes(job.backend_status))
    return err(
      res,
      400,
      `Cannot assign driver in status: ${job.backend_status}`,
    );
  if (!req.body.driver_id) return err(res, 400, "driver_id is required");

  if (req.body.isConfirmed !== true) {
    return ok(
      res,
      {
        job_id: job.id,
        status: "WAITING_CONFIRMATION",
      },
      { message: "กรุณากดปุ่ม Confirm? อีกครั้งเพื่อยืนยันการจ่ายงาน" },
    );
  }

  const driver = drivers.find((d) => d.id === req.body.driver_id);
  if (!driver) return err(res, 404, "Driver not found");

  job.driver_id = driver.id;
  job.backend_status = "DRIVER_ASSIGNED";
  job.job_history.push({
    date_time: dayjs().toISOString(),
    event: "Driver Assigned",
    actor: `[Admin] ${req.body.admin_name || "Admin"}`,
    target: null,
    reason: null,
  });

  ok(
    res,
    {
      job_id: job.id,
      new_status: "DRIVER_ASSIGNED",
      assign_status: "ASSIGNED",
      driver: { id: driver.id, name: driver.name, plate: driver.plate },
    },
    { message: `Driver ${driver.name} assigned successfully` },
  );
});

// ------------------------------------------------------------------
// POST /driver-assignments/:jobId/reassign
// Body: { reason: string, admin_name?: string }
// ------------------------------------------------------------------
router.post("/:jobId/reassign", (req, res) => {
  const job = jobs.find((j) => j.id === req.params.jobId);
  if (!job) return err(res, 404, "Job not found");
  if (!req.body.reason) return err(res, 400, "Reassign reason is required");

  const prevDriver = drivers.find((d) => d.id === job.driver_id);
  job.backend_status = "REJECTED_DRIVER";
  job.job_history.push({
    date_time: dayjs().toISOString(),
    event: "Driver Reassigned",
    actor: `[Admin] ${req.body.admin_name || "Admin"}`,
    target: null,
    reason: req.body.reason,
  });
  job.driver_id = null;

  ok(
    res,
    {
      job_id: job.id,
      new_status: "REJECTED_DRIVER",
      assign_status: "UNASSIGNED_ALERT",
      previous_driver: prevDriver?.name ?? null,
    },
    { message: "Driver reassignment initiated. Please assign a new driver." },
  );
});

// ------------------------------------------------------------------
// POST /driver-assignments/:jobId/driver-accept  (simulate driver accept from APP)
// ------------------------------------------------------------------
router.post("/:jobId/driver-accept", (req, res) => {
  const job = jobs.find((j) => j.id === req.params.jobId);
  if (!job) return err(res, 404, "Job not found");
  if (job.backend_status !== "DRIVER_ASSIGNED")
    return err(res, 400, "Job not in DRIVER_ASSIGNED status");

  job.backend_status = "CONFIRMED";
  job.job_status = "RECEIVED";
  job.accept_deadline = null; // stop timer
  const driver = drivers.find((d) => d.id === job.driver_id);
  job.job_history.push({
    date_time: dayjs().toISOString(),
    event: "Driver Accepted",
    actor: `[Driver] ${driver?.name ?? "Driver"}`,
    target: null,
    reason: null,
  });

  ok(
    res,
    { job_id: job.id, new_status: "CONFIRMED", assign_status: "ACCEPTED" },
    { message: "Driver accepted the job" },
  );
});

module.exports = router;
