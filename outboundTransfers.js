const express = require("express");
const router = express.Router();
const dayjs = require("dayjs");
const { jobs, drivers, carriers, shippers, customers } = require("./mockdata");
const {
  formatDueDate,
  getSmartMatchLevel,
  getTransferStatus,
  paginate,
  ok,
  err,
} = require("./helpers");

/** customer_id → name lookup */
function resolveCustomer(id) {
  return customers.find((c) => c.id === id)?.name ?? id;
}

/** Format created_at → "YYYY-MM-DD HH:mm A" to match UI display */
function formatCreatedAt(iso) {
  if (!iso) return null;
  return dayjs(iso).format("YYYY-MM-DD hh:mm A");
}

/**
 * Enrich each item with:
 *  - has_zero_dimension  (flags red row in UI when any of w/l/h/weight = 0)
 *  - qa default null
 *  - reference default null
 */
function enrichItems(items = []) {
  return items.map((item) => ({
    ...item,
    qa: item.qa ?? null,
    reference: item.reference ?? null,
    has_zero_dimension: [item.w, item.l, item.h, item.weight].some(
      (v) => v === 0,
    ),
  }));
}

/**
 * Derive which action buttons are available based on backend_status.
 * Mirrors the "Publish to Marketplace / Save as Draft / Cancel /
 * Save & Select Carrier" logic in section 2.13.4 of the blueprint.
 */
function resolveActions(backendStatus) {
  const editable = ["DRAFT", "UNASSIGNED"].includes(backendStatus);
  return {
    can_cancel: editable,
    can_save_as_draft: backendStatus === "DRAFT",
    can_publish: backendStatus === "DRAFT", // → becomes UNASSIGNED, opens Carrier Modal
    can_save_select_carrier: backendStatus === "UNASSIGNED", // re-opens Carrier Selection Modal
    can_return_to_pod: ["DRAFT", "UNASSIGNED", "PENDING_CARRIER"].includes(
      backendStatus,
    ),
    publish_button_label:
      backendStatus === "UNASSIGNED"
        ? "Save & Select Carrier"
        : "Publish to Marketplace",
  };
}

const OUTBOUND_STATUSES = [
  "DRAFT",
  "UNASSIGNED",
  "PENDING_CARRIER",
  "PENDING_DRIVER",
  "DRIVER_ASSIGNED",
  "CONFIRMED",
  "COMPLETED",
  "REJECTED_ADMIN",
  "TIMEOUT",
];

function buildOutboundRow(job) {
  const carrier = carriers.find((c) => c.id === job.carrier_id);
  const driver = drivers.find((d) => d.id === job.driver_id);
  const driverLabel =
    job.backend_status === "PENDING_DRIVER"
      ? "Awaiting Driver"
      : (driver?.name ?? null);

  return {
    job_id: job.id,
    transfer_status: getTransferStatus(job.backend_status),
    job_status: job.job_status,
    origin: job.origin,
    destination: job.destination,
    carrier: carrier?.name ?? null,
    assigned_driver: driverLabel,
    pickup_due: formatDueDate(job.pickup_due),
    delivery_due: formatDueDate(job.delivery_due),
    est_delivery_time:
      job.backend_status === "CONFIRMED"
        ? formatDueDate(job.delivery_due)
        : null,
  };
}

// ------------------------------------------------------------------
// GET /outbound-transfers
// Query: transfer_status, job_status, carrier, customer, destination,
//        pickup_date_from, pickup_date_to, search, page, limit
// ------------------------------------------------------------------
router.get("/", (req, res) => {
  // For POC: treat jobs owned by CAR001 as the Shipper (outbound side)
  let list = jobs.filter((j) => OUTBOUND_STATUSES.includes(j.backend_status));

  if (req.query.company_id) {
    list = list.filter((j) => j.shipper_id === req.query.company_id);
  }

  if (req.query.transfer_status) {
    list = list.filter(
      (j) => getTransferStatus(j.backend_status) === req.query.transfer_status,
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
  if (req.query.carrier) {
    const c = carriers.find((x) =>
      x.name.toLowerCase().includes(req.query.carrier.toLowerCase()),
    );
    if (c) list = list.filter((j) => j.carrier_id === c.id);
  }
  if (req.query.destination) {
    list = list.filter((j) =>
      j.destination.toLowerCase().includes(req.query.destination.toLowerCase()),
    );
  }
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

  // Priority: DRAFT → UNASSIGNED_ALERT → UNASSIGNED → PENDING_CARRIER → PENDING_DRIVER → CONFIRMED → COMPLETED
  const priority = [
    "DRAFT",
    "UNASSIGNED_ALERT",
    "UNASSIGNED",
    "PENDING_CARRIER",
    "PENDING_DRIVER",
    "CONFIRMED",
    "COMPLETED",
  ];
  list.sort(
    (a, b) =>
      priority.indexOf(getTransferStatus(a.backend_status)) -
      priority.indexOf(getTransferStatus(b.backend_status)),
  );

  let baseList = jobs.filter((j) =>
    OUTBOUND_STATUSES.includes(j.backend_status),
  );
  if (req.query.company_id) {
    baseList = baseList.filter((j) => j.shipper_id === req.query.company_id);
  }
  const summary = {
    all: baseList.length,
    draft: baseList.filter((j) => j.backend_status === "DRAFT").length,
    unassigned: baseList.filter((j) =>
      ["UNASSIGNED", "REJECTED_ADMIN", "TIMEOUT"].includes(j.backend_status),
    ).length,
    pending: baseList.filter((j) =>
      ["PENDING_CARRIER", "PENDING_DRIVER", "DRIVER_ASSIGNED"].includes(
        j.backend_status,
      ),
    ).length,
    confirmed: baseList.filter((j) => j.backend_status === "CONFIRMED").length,
    completed: baseList.filter((j) => j.backend_status === "COMPLETED").length,
  };

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const paged = paginate(list.map(buildOutboundRow), page, limit);

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
// GET /outbound-transfers/:jobId
// Returns complete job detail matching Job Information modal UI.
// ------------------------------------------------------------------
router.get("/:jobId", (req, res) => {
  const job = jobs.find(
    (j) =>
      j.id === req.params.jobId && OUTBOUND_STATUSES.includes(j.backend_status),
  );
  if (!job) return err(res, 404, "Job not found in Outbound Transfers");

  const carrier = carriers.find((c) => c.id === job.carrier_id);
  const driver = drivers.find((d) => d.id === job.driver_id);
  const isEditable = ["DRAFT", "UNASSIGNED"].includes(job.backend_status);

  // ── 1. Enrich items with zero-dimension flag, qa, reference ────────────
  const enrichedItems = enrichItems(job.items);

  // ── 2. Pickup / Delivery point — add due_date field separately ─────────
  function enrichPoint(point, dueIso) {
    if (!point) return null;
    const dueDateFormatted = dueIso ? dayjs(dueIso).format("MM/DD/YYYY") : null;
    const dueTimeFormatted = dueIso ? dayjs(dueIso).format("HH:mm") : null;
    return {
      point_name: point.name,
      address: point.address,
      location_remarks: point.location_remarks ?? null, // ADD-ONS field in UI
      contact_name: point.contact_name,
      phone: point.phone,
      due_date: dueDateFormatted, // calendar field
      due_time: point.due_time ?? dueTimeFormatted,
      time_window_slots: point.time_window ?? [],
    };
  }

  // ── 3. Validation errors (powers red rows / missing field highlights) ───
  const validationErrors = [];
  if (!job.vehicle_type_required) {
    validationErrors.push({
      field: "vehicle_type_required",
      message: "Vehicle type is required before publishing",
    });
  }
  if (job.price === null || job.price === undefined) {
    validationErrors.push({
      field: "price",
      message: "Marketplace price is required before publishing",
    });
  }
  if (!job.pickup_point?.due_time && !job.pickup_due) {
    validationErrors.push({
      field: "pickup.due_time",
      message: "Pickup due time is required",
    });
  }
  enrichedItems.forEach((item, i) => {
    if (item.has_zero_dimension) {
      validationErrors.push({
        field: `items[${i}]`,
        code: item.code,
        message:
          "Item has zero dimension (W/L/H/Weight). Please correct before publishing.",
      });
    }
  });

  // ── 4. Route map ───────────────────────────────────────────────────────
  const routeMap = {
    origin: {
      label: "Origin",
      address: job.pickup_point?.address ?? null,
      lat: 13.641, // mock coords — real system would geocode from address
      lng: 100.502,
    },
    destination: {
      label: "Destination",
      address: job.delivery_point?.address ?? null,
      lat: 13.756,
      lng: 100.521,
    },
  };

  // ── 5. Driver display logic (per blueprint 2.13.1 field #6) ───────────
  const driverDisplay = ["CONFIRMED", "COMPLETED"].includes(job.backend_status)
    ? (driver?.name ?? null)
    : "Awaiting Carrier Assignment";

  // ── Build response ─────────────────────────────────────────────────────
  ok(res, {
    // ── Header ──────────────────────────────────────────────────────────
    job_id: job.id,
    transfer_status: getTransferStatus(job.backend_status),
    backend_status: job.backend_status,
    is_editable: isEditable,

    // ── Job Information section ─────────────────────────────────────────
    job_information: {
      job_id: job.id,
      job_status: job.job_status, // "Open" / "Received" / etc.
      customer: resolveCustomer(job.customer_id), // resolved name, not raw id
      created_at: formatCreatedAt(job.created_at), // "2023-10-24 09:15 AM"
      carrier: carrier?.name ?? "Awaiting Marketplace Match",
      driver: driverDisplay,
      remark: job.remark ?? "",
      attachments: job.attachments ?? [], // [{filename, url, size_mb}]
    },

    // ── Pickup / Delivery ───────────────────────────────────────────────
    pickup: enrichPoint(job.pickup_point, job.pickup_due),
    delivery: enrichPoint(job.delivery_point, job.delivery_due),

    // ── Route Map ───────────────────────────────────────────────────────
    route_map: routeMap,

    // ── Items table ─────────────────────────────────────────────────────
    items: enrichedItems,
    total_weight_kg: job.total_weight_kg,
    total_volume_cbm: job.total_volume_cbm,
    items_have_errors: enrichedItems.some((i) => i.has_zero_dimension),

    // ── Vehicle Type Requirements (radio buttons) ────────────────────────
    vehicle_type_requirements: {
      selected: job.vehicle_type_required,
      is_required: true,
    },

    // ── Job Summary ─────────────────────────────────────────────────────
    job_summary: {
      distance_km: job.distance_km,
      est_eta_hrs: job.est_eta_hrs,
      weight_kg: job.total_weight_kg, // was missing before
      total_items: job.total_items,
    },

    // ── Pricing ─────────────────────────────────────────────────────────
    pricing: {
      price: job.price,
      currency: "THB",
      label: "MARKETPLACE JOB PRICE",
    },

    // ── Validation errors (frontend uses to highlight fields) ─────────
    validation_errors: validationErrors,
    is_publishable: validationErrors.length === 0,

    // ── Action buttons state ─────────────────────────────────────────
    actions: resolveActions(job.backend_status),

    // ── Transfer History tab ────────────────────────────────────────
    transfer_history: job.transfer_history,
  });
});

// ------------------------------------------------------------------
// PATCH /outbound-transfers/:jobId   — save as draft
// Body: { vehicle_type_required?, price?, remark?, pickup_point?, delivery_point?, items? }
// ------------------------------------------------------------------
router.patch("/:jobId", (req, res) => {
  const job = jobs.find((j) => j.id === req.params.jobId);
  if (!job) return err(res, 404, "Job not found");
  if (!["DRAFT", "UNASSIGNED"].includes(job.backend_status))
    return err(res, 400, "Job is not editable");

  const {
    vehicle_type_required,
    price,
    remark,
    pickup_point,
    delivery_point,
    items,
  } = req.body;

  if (vehicle_type_required !== undefined)
    job.vehicle_type_required = vehicle_type_required;
  if (price !== undefined) job.price = price;
  if (remark !== undefined) job.remark = remark;
  if (pickup_point !== undefined) Object.assign(job.pickup_point, pickup_point);
  if (delivery_point !== undefined)
    Object.assign(job.delivery_point, delivery_point);

  if (items !== undefined) {
    job.items = items;

    job.total_items = items.reduce((sum, i) => sum + (i.qty ?? 0), 0);

    job.total_weight_kg = parseFloat(
      items
        .reduce((sum, i) => sum + (i.weight ?? 0) * (i.qty ?? 0), 0)
        .toFixed(2),
    );

    job.total_volume_cbm = parseFloat(
      items
        .reduce((sum, i) => {
          const vol = ((i.w ?? 0) * (i.l ?? 0) * (i.h ?? 0)) / 1_000_000;
          return sum + vol * (i.qty ?? 0);
        }, 0)
        .toFixed(4),
    );
  }

  ok(
    res,
    {
      job_id: job.id,
      transfer_status: getTransferStatus(job.backend_status),
      total_items: job.total_items,
      total_weight_kg: job.total_weight_kg,
      total_volume_cbm: job.total_volume_cbm,
    },
    { message: "Job saved as draft" },
  );
});

// ------------------------------------------------------------------
// POST /outbound-transfers/:jobId/publish  — publish to marketplace
// ------------------------------------------------------------------
router.post("/:jobId/publish", (req, res) => {
  const job = jobs.find((j) => j.id === req.params.jobId);
  if (!job) return err(res, 404, "Job not found");
  if (!["DRAFT"].includes(job.backend_status))
    return err(
      res,
      400,
      `Job is already published or cannot be published: ${job.backend_status}`,
    );

  // บันทึกข้อมูลที่ส่งมาพร้อมกับ publish
  const {
    vehicle_type_required,
    price,
    remark,
    pickup_point,
    delivery_point,
    items,
    admin_name,
  } = req.body;

  if (vehicle_type_required !== undefined)
    job.vehicle_type_required = vehicle_type_required;
  if (price !== undefined) job.price = price;
  if (remark !== undefined) job.remark = remark;
  if (pickup_point !== undefined) Object.assign(job.pickup_point, pickup_point);
  if (delivery_point !== undefined)
    Object.assign(job.delivery_point, delivery_point);

  // Auto-calculate totals
  if (items !== undefined) {
    job.items = items;

    job.total_items = items.reduce((sum, i) => sum + (i.qty ?? 0), 0);

    job.total_weight_kg = parseFloat(
      items
        .reduce((sum, i) => sum + (i.weight ?? 0) * (i.qty ?? 0), 0)
        .toFixed(2),
    );

    job.total_volume_cbm = parseFloat(
      items
        .reduce((sum, i) => {
          const vol = ((i.w ?? 0) * (i.l ?? 0) * (i.h ?? 0)) / 1_000_000;
          return sum + vol * (i.qty ?? 0);
        }, 0)
        .toFixed(4),
    );
  }

  // ── Mock Map API — จำลองค่าที่คำนวณจาก origin → destination
  // ระบบจริงเรียก Google Maps / internal routing engine
  job.distance_km = job.distance_km ?? 45; // mock
  job.est_eta_hrs = job.est_eta_hrs ?? 1.5; // mock

  const missing = [];
  if (!job.vehicle_type_required) missing.push("vehicle_type_required");
  if (!job.price) missing.push("price");
  if (!job.pickup_point?.due_time) missing.push("pickup_point.due_time");
  if (missing.length > 0)
    return err(res, 422, `Missing required fields: ${missing.join(", ")}`);

  job.backend_status = "UNASSIGNED";
  job.job_status = "OPEN";

  // บันทึก event log
  // ระบบจริง admin_name ดึงจาก JWT token ไม่ใช่ body
  job.transfer_history.push({
    date_time: dayjs().toISOString(),
    event: "Published",
    actor: admin_name || req.headers["x-admin-name"] || "Admin",
    target: null,
    reason: null,
  });

  ok(res, {
    job_id: job.id,
    transfer_status: "UNASSIGNED",
    job_status: "OPEN",
    map_api_result: {
      note: "Mocked values — real system calls Map API on publish",
      distance_km: job.distance_km,
      est_eta_hrs: job.est_eta_hrs,
    },
    totals: {
      note: "Auto-calculated from items",
      total_items: job.total_items,
      total_weight_kg: job.total_weight_kg,
      total_volume_cbm: job.total_volume_cbm,
    },
    message: "Job published. Please select a carrier.",
  });
});

// ------------------------------------------------------------------
// POST /outbound-transfers/:jobId/select-carrier
// Body: { carrier_id: string, admin_name?: string }
// ------------------------------------------------------------------
router.post("/:jobId/select-carrier", (req, res) => {
  const job = jobs.find((j) => j.id === req.params.jobId);
  if (!job) return err(res, 404, "Job not found");
  if (!["UNASSIGNED"].includes(job.backend_status))
    return err(
      res,
      400,
      `Cannot select carrier in status: ${job.backend_status}`,
    );
  if (!req.body.carrier_id) return err(res, 400, "carrier_id is required");

  const carrier = carriers.find((c) => c.id === req.body.carrier_id);
  if (!carrier) return err(res, 404, "Carrier not found");

  job.carrier_id = carrier.id;
  job.backend_status = "PENDING_CARRIER";
  job.accept_deadline = dayjs().add(1, "hour").toISOString();
  job.transfer_history.push({
    date_time: dayjs().toISOString(),
    event: "Carrier Assigned",
    actor: req.body.admin_name || "Admin",
    target: carrier.name,
    reason: null,
  });

  ok(
    res,
    {
      job_id: job.id,
      transfer_status: "PENDING_CARRIER",
      carrier: { id: carrier.id, name: carrier.name },
      accept_deadline: job.accept_deadline,
    },
    { message: "Job sent to carrier. Awaiting carrier acceptance." },
  );
});

// ------------------------------------------------------------------
// POST /outbound-transfers/:jobId/return-to-pod
// Body: { job_ids?: string[], admin_name?: string }  (supports bulk via body)
// ------------------------------------------------------------------
router.post("/:jobId/return-to-pod", (req, res) => {
  const job = jobs.find((j) => j.id === req.params.jobId);
  if (!job) return err(res, 404, "Job not found");
  if (
    !["DRAFT", "UNASSIGNED", "PENDING_CARRIER"].includes(job.backend_status)
  ) {
    return err(
      res,
      400,
      `Cannot return job in status: ${job.backend_status}. Job must not be CONFIRMED yet.`,
    );
  }

  const prevStatus = job.backend_status;
  job.backend_status = "RETURNED_TO_POD";
  job.transfer_history.push({
    date_time: dayjs().toISOString(),
    event: "Returned to POD",
    actor: req.body.admin_name || "Admin",
    target: null,
    reason: null,
  });

  ok(res, {
    job_id: job.id,
    previous_status: prevStatus,
    new_status: "RETURNED_TO_POD",
    message:
      "Job returned to POD. It will be hidden from Marketplace until re-transferred.",
  });
});

module.exports = router;
