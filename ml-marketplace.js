const express = require("express");
const router = express.Router();
const axios = require("axios");
const { jobs, carriers, drivers } = require("./mockdata");
const {
  getSmartMatchLevel,
  ok,
  err,
  formatAcceptDeadline,
} = require("./helpers");

// ================================================================= //
// Outbound (Shipper View):
//   GET /marketplace/ml-match/:jobId?view=carrier
//
// Inbound / Driver (Carrier View):
//   GET /marketplace/ml-match/:jobId?view=driver&carrier_id=CAR001
// ================================================================= //

// ── PRE-FILTER ────────────────────────────────────────────
function preFilter(job, driverPool) {
  return driverPool.filter((driver) => {
    if (!driver.marketplace_active) return false;
    if (driver.vehicle_type !== job.vehicle_type_required) return false;
    if ((driver.available_capacity_kg ?? 0) < (job.total_weight_kg ?? 0))
      return false;

    const specs = driver.vehicle_specs ?? {};
    if ((specs.height_m ?? 0) === 0) {
      const truckFloor = (specs.width_m ?? 0) * (specs.length_m ?? 0);
      const itemsFloor = (job.items ?? []).reduce(
        (sum, item) => sum + (item.w ?? 0) * (item.l ?? 0) * (item.qty ?? 0),
        0,
      );
      if (truckFloor < itemsFloor) return false;
    } else {
      if ((specs.capacity_volume_cbm ?? 0) < (job.total_volume_cbm ?? 0))
        return false;
    }
    return true;
  });
}

// ── MOCK ROUTE DATA (for POC) ──────────────────────────────────────
function mockRouteData(driver, job) {
  return {
    dist_current_to_pickup: parseFloat((Math.random() * 30).toFixed(1)),
    dist_pickup_to_dropoff: parseFloat((Math.random() * 80 + 10).toFixed(1)),
    dist_dropoff_to_next_stop: parseFloat((Math.random() * 20).toFixed(1)),
    dist_current_to_next_stop: parseFloat((Math.random() * 40).toFixed(1)),
    dist_current_to_depot: parseFloat((Math.random() * 50).toFixed(1)),
    dist_dropoff_to_depot: parseFloat((Math.random() * 50).toFixed(1)),
    dist_pickup_to_cluster: parseFloat((Math.random() * 20).toFixed(1)),
    dist_dropoff_to_cluster: parseFloat((Math.random() * 20).toFixed(1)),
    prop_distance: parseFloat((Math.random() * 30).toFixed(1)),
    pickup_eta_minutes: Math.floor(Math.random() * 40),
    late_penalty_minutes: Math.floor(Math.random() * 20),
    is_same_direction: Math.random() > 0.3,
    has_active_cluster: Math.random() > 0.5,
    remaining_stop_count: Math.floor(Math.random() * 5),
  };
}

// ── ML DATASET RECORD ────────────────────────────────────
function buildMLRecord(job, driver, routeData, matchResult) {
  const fuelCostPerKm = driver.calculated_fuel_cost_per_km ?? 3.0;
  const detourKm = matchResult.detour_distance ?? routeData.prop_distance ?? 0;
  const estFuelCost = parseFloat((fuelCostPerKm * detourKm).toFixed(2));

  return {
    job_id: job.id, // เพิ่ม Metadata
    driver_id: driver.id, // เพิ่ม Metadata
    created_at: new Date().toISOString(), // เพิ่ม Timestamp

    historical_accept_rate: driver.historical_accept_rate ?? null,
    historical_cancel_rate: driver.historical_cancel_rate ?? null,
    historical_framework_preference:
      driver.historical_framework_preference ?? null,

    matched_framework: matchResult.framework_used ?? null,
    framework_match: matchResult.is_match,
    has_rejected_this_job: driver.has_rejected_this_job ?? false,

    fatigue_level: driver.fatigue_level ?? null,
    earnings_today: driver.earnings_today ?? null,
    idle_time_minutes: driver.idle_time_minutes ?? null,
    hour_of_day: new Date().getHours(),
    current_load_utilization: driver.current_load_utilization ?? null,
    route_completion_ratio: driver.route_completion_ratio ?? null,
    is_returning: driver.is_returning ?? null,
    distance_to_home_depot: driver.distance_to_home_depot ?? null,

    pickup_detour_km: routeData.dist_current_to_pickup ?? null,
    total_detour_km: detourKm,
    eta_delay_minutes: routeData.late_penalty_minutes ?? null,
    estimated_fuel_cost: estFuelCost,
    expected_margin: driver.expected_margin ?? null,
    margin_per_km: driver.margin_per_km ?? null,

    nearby_driver_count: driver.nearby_driver_count ?? null,
    marketplace_job_density: driver.marketplace_job_density ?? null,
    supply_demand_ratio: driver.supply_demand_ratio ?? null,

    accepted: null,
  };
}

// ── VIEW BUILDERS ─────────────────────────────────────────────────
function buildCarrierView(scoredResults) {
  const carrierMap = {};
  for (const r of scoredResults) {
    const driver = r._driver;
    let carrier = null;
    if (driver.carrier_id) {
      carrier = carriers.find((c) => c.id === driver.carrier_id);
    }
    if (!carrier) {
      carrier =
        carriers.find((c) =>
          driver.group
            ?.toLowerCase()
            .includes(c.name.split(" ")[0].toLowerCase()),
        ) ?? carriers[0];
    }

    if (!carrierMap[carrier.id]) {
      carrierMap[carrier.id] = {
        carrier_id: carrier.id,
        carrier_name: carrier.name,
        best_match_pct: 0,
        best_match_level: null,
        available_drivers: 0,
        drivers: [],
      };
    }

    const entry = carrierMap[carrier.id];
    if (r.smart_match_pct > entry.best_match_pct) {
      entry.best_match_pct = r.smart_match_pct;
      entry.best_match_level = getSmartMatchLevel(r.smart_match_pct);
    }
    entry.available_drivers += 1;
    entry.drivers.push({
      driver_id: driver.id,
      driver_name: driver.name,
      smart_match_pct: r.smart_match_pct,
      smart_match_level: getSmartMatchLevel(r.smart_match_pct),
      framework_used: r.framework_used,
    });
  }
  return Object.values(carrierMap).sort(
    (a, b) => b.best_match_pct - a.best_match_pct,
  );
}

function buildDriverView(scoredResults) {
  return scoredResults.map((r) => {
    const driver = r._driver;
    return {
      driver_id: driver.id,
      driver_name: driver.name,
      carrier_id: driver.carrier_id ?? null,
      group: driver.group ?? null,
      rating: driver.rating ?? null,
      vehicle_type: driver.vehicle_type ?? null,
      available_capacity_kg: driver.available_capacity_kg ?? null,
      smart_match_pct: r.smart_match_pct,
      smart_match_level: getSmartMatchLevel(r.smart_match_pct),
      framework_used: r.framework_used,
      has_rejected_this_job: r.has_rejected_this_job,
    };
  });
}

// ── ROUTE HANDLER ─────────────────────────────────────────────────
router.get("/ml-match/:jobId", async (req, res) => {
  try {
    const job = jobs.find((j) => j.id === req.params.jobId);
    if (!job) return err(res, 404, "Job not found");

    const view = req.query.view?.toLowerCase() ?? "driver";
    if (!["carrier", "driver"].includes(view)) {
      return err(res, 400, "view must be 'carrier' or 'driver'");
    }

    const carrierId = req.query.carrier_id;
    if (view === "driver" && !carrierId) {
      return err(res, 400, "carrier_id is required when view=driver");
    }

    let pool = [...drivers];
    if (view === "driver") {
      pool = pool.filter((d) => d.carrier_id === carrierId);
      if (pool.length === 0)
        return err(res, 404, `No drivers found for carrier_id: ${carrierId}`);
    }

    const isAssigned = ["DRIVER_ASSIGNED", "CONFIRMED", "COMPLETED"].includes(
      job.backend_status,
    );

    if (view === "driver" && isAssigned) {
      const assignedDriver = drivers.find((d) => d.id === job.driver_id);

      return ok(
        res,
        {
          job_id: job.id,
          view: "driver",
          carrier_id: carrierId,
          vehicle_type_required: job.vehicle_type_required,
          is_assigned: true,

          assigned_driver: assignedDriver
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
                  fuel_cost_per_km: assignedDriver.calculated_fuel_cost_per_km,
                  fixed_cost_thb: assignedDriver.fixed_cost,
                  time_cost_per_min_thb: assignedDriver.time_cost_per_min,
                },
                timeout_countdown: job.accept_deadline
                  ? formatAcceptDeadline(job.accept_deadline)
                  : null,
                is_accepted: ["CONFIRMED", "COMPLETED"].includes(
                  job.backend_status,
                ),
              }
            : null,
        },
        {
          message: "Job is already assigned. ML Match bypassed.",
        },
      );
    }

    const filtered = preFilter(job, pool);

    // จำลองข้อมูล Route ให้แต่ละคันที่ผ่าน Filter
    const routeDataMap = {};
    for (const driver of filtered) {
      routeDataMap[driver.id] = mockRouteData(driver, job);
    }

    // ยิง Request ไปหา Python Microservice
    const pythonResponse = await axios.post(
      "http://localhost:8000/api/calculate-match",
      {
        job: job,
        filtered_drivers: filtered,
        route_data_map: routeDataMap,
      },
    );

    const scoredResults = pythonResponse.data.data;
    const mlDataset = [];

    // นำผลลัพธ์จาก Python มาจับคู่กับข้อมูลเดิมเพื่อปั้น View และเก็บ Dataset
    for (const matchResult of scoredResults) {
      const driver = filtered.find((d) => d.id === matchResult.driver_id);
      const routeData = routeDataMap[driver.id];

      matchResult._driver = driver;

      mlDataset.push(buildMLRecord(job, driver, routeData, matchResult));
    }

    scoredResults.sort((a, b) => {
      if (a.has_rejected_this_job !== b.has_rejected_this_job) {
        return (
          Number(a.has_rejected_this_job) - Number(b.has_rejected_this_job)
        );
      }
      return b.smart_match_pct - a.smart_match_pct;
    });

    const meta = {
      system_phase: 1,
      scoring_method: "rule_based",
      ml_model: "pending_production_data",
      pre_filter_passed: filtered.length,
      total_matched: scoredResults.length,
      ml_records_staged: mlDataset.length,
    };

    if (view === "carrier") {
      const candidates = buildCarrierView(scoredResults);
      return ok(
        res,
        {
          job_id: job.id,
          view: "carrier",
          vehicle_type_required: job.vehicle_type_required,
          total_carriers_matched: candidates.length,
          total_drivers_matched: scoredResults.length,
          candidates,
        },
        meta,
      );
    }

    const candidates = buildDriverView(scoredResults);
    return ok(
      res,
      {
        job_id: job.id,
        view: "driver",
        carrier_id: carrierId,
        vehicle_type_required: job.vehicle_type_required,
        total_candidates: candidates.length,
        candidates,
      },
      meta,
    );
  } catch (error) {
    console.error("Smart Match API Error:", error.message);
    return err(
      res,
      500,
      "Internal Server Error during Smart Match. Please check if Python API is running.",
    );
  }
});

module.exports = router;
