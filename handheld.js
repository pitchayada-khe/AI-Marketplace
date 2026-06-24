const express = require("express");
const router = express.Router();
const dayjs = require("dayjs");
const { jobs, drivers } = require("./mockdata");
const { ok, err } = require("./helpers");

// ------------------------------------------------------------------
// Handheld — vehicle MP settings
// GET  /handheld/:driverId/mp-settings
// POST /handheld/:driverId/mp-settings
// ------------------------------------------------------------------
router.get("/:driverId/mp-settings", (req, res) => {
  const driver = drivers.find((d) => d.id === req.params.driverId);
  if (!driver) return err(res, 404, "Driver not found");

  const mockFuelPrice = { Diesel: 32.5, Gasoline: 40.8, EV: 0 };
  const fuelPrice = mockFuelPrice[driver.fuel_type] ?? 0;
  const fuelCostPerKm = driver.fuel_consumption_rate
    ? parseFloat((fuelPrice / driver.fuel_consumption_rate).toFixed(4))
    : driver.fuel_cost_per_km;
  const calculatedVolume = (
    (driver.vehicle_specs.length_m || 0) *
    (driver.vehicle_specs.width_m || 0) *
    (driver.vehicle_specs.height_m || 0)
  ).toFixed(2);

  ok(res, {
    driver_id: driver.id,
    driver_name: driver.name,
    marketplace_active: true,
    fuel_type: driver.fuel_type,
    current_fuel_price_thb: fuelPrice,
    fuel_consumption_rate_km_per_l: driver.fuel_consumption_rate ?? 10,
    calculated_fuel_cost_per_km: fuelCostPerKm,
    fixed_cost_thb: driver.fixed_cost,
    time_cost_per_min_thb: driver.time_cost_per_min,
    vehicle_type: driver.vehicle_type,
    capacity_weight_kg: driver.vehicle_specs.weight_kg,
    dimensions: {
      length_m: driver.vehicle_specs.length_m,
      width_m: driver.vehicle_specs.width_m,
      height_m: driver.vehicle_specs.height_m,
    },
    capacity_volume_cbm: parseFloat(calculatedVolume),
  });
});

router.post("/:driverId/mp-settings", (req, res) => {
  const driver = drivers.find((d) => d.id === req.params.driverId);
  if (!driver) return err(res, 404, "Driver not found");

  const {
    fuel_type,
    fuel_consumption_rate_km_per_l,
    fixed_cost_thb,
    time_cost_per_min_thb,
    vehicle_type,
    capacity_weight_kg,
    length_m,
    width_m,
    height_m,
  } = req.body;

  const required = {
    fuel_type,
    fuel_consumption_rate_km_per_l,
    fixed_cost_thb,
    time_cost_per_min_thb,
    vehicle_type,
    capacity_weight_kg,
    length_m,
    width_m,
  };
  const missing = Object.entries(required)
    .filter(([k, v]) => v === undefined || v === null)
    .map(([k]) => k);
  if (missing.length > 0)
    return err(res, 422, `Missing required fields: ${missing.join(", ")}`);
  if (fuel_consumption_rate_km_per_l <= 0)
    return err(res, 422, "fuel_consumption_rate must be > 0");

  // Apply to mock
  if (fuel_type) driver.fuel_type = fuel_type;
  if (fixed_cost_thb !== undefined) driver.fixed_cost = fixed_cost_thb;
  if (time_cost_per_min_thb !== undefined)
    driver.time_cost_per_min = time_cost_per_min_thb;
  if (vehicle_type) driver.vehicle_type = vehicle_type;
  if (capacity_weight_kg) driver.vehicle_specs.weight_kg = capacity_weight_kg;
  if (length_m) driver.vehicle_specs.length_m = length_m;
  if (width_m) driver.vehicle_specs.width_m = width_m;
  if (height_m !== undefined) driver.vehicle_specs.height_m = height_m;

  const newVolume = parseFloat(
    (length_m * width_m * (height_m ?? 0)).toFixed(2),
  );

  ok(
    res,
    {
      driver_id: driver.id,
      marketplace_active: true,
      capacity_volume_cbm: newVolume,
      height_zero_interpretation: height_m === 0 ? true : false,
    },
    { message: "MP settings saved successfully" },
  );
});

module.exports = router;
