class MatchConfig:
    SYSTEM_PHASE = 1  # 1 = Rule-Based, 2 = ML Model
    
    # M1 Thresholds
    M1_DETOUR_MAX_KM = 50
    M1_PICKUP_MAX_KM = 20
    
    # M2 Thresholds
    M2_RADIUS_KM = 20
    M2_PICKUP_ETA_MAX_MINS = 30
    M2_LATE_MAX_MINS = 15
    
    # M3 Thresholds
    M3_PICKUP_MAX_KM = 30
    M3_DROPOFF_MAX_KM = 50
    M3_LATE_MAX_MINS = 30
    
    # M4 Thresholds
    M4_BACKHAUL_DETOUR_MAX_KM = 50
    
    # M5 Thresholds
    M5_CLUSTER_RADIUS_KM = 15
    M5_DETOUR_MAX_KM = 30
    M5_LATE_MAX_MINS = 15

# ================================================================= #

def calculate_insertion_cost(driver, prop_distance):
    cost_per_km = driver.get("calculated_fuel_cost_per_km", 3.0)
    return prop_distance * cost_per_km

def check_m1_on_route(driver, route_data):
    prop_distance = (
        route_data["dist_current_to_pickup"] + 
        route_data["dist_pickup_to_dropoff"] + 
        route_data["dist_dropoff_to_next_stop"]
    ) - route_data["dist_current_to_next_stop"]

    is_detour_ok = prop_distance <= MatchConfig.M1_DETOUR_MAX_KM
    is_pickup_near = route_data["dist_current_to_pickup"] <= MatchConfig.M1_PICKUP_MAX_KM
    is_not_late = route_data["late_penalty_minutes"] == 0

    if is_detour_ok and is_pickup_near and route_data["is_same_direction"] and is_not_late:
        return {
            "is_match": True,
            "framework": "M1_ON_ROUTE",
            "detour_distance": prop_distance,
            "insertion_cost": calculate_insertion_cost(driver, prop_distance),
            "late_penalty": 0
        }
    return {"is_match": False}

def check_m2_near_current(driver, route_data):
    is_within_radius = route_data["dist_current_to_pickup"] <= MatchConfig.M2_RADIUS_KM
    is_quick_pickup = route_data["pickup_eta_minutes"] <= MatchConfig.M2_PICKUP_ETA_MAX_MINS
    is_late_ok = route_data["late_penalty_minutes"] <= MatchConfig.M2_LATE_MAX_MINS

    if is_within_radius and route_data["is_same_direction"] and is_quick_pickup and is_late_ok:
        prop_distance = route_data.get("prop_distance", 0)
        return {
            "is_match": True,
            "framework": "M2_NEAR_CURRENT",
            "detour_distance": prop_distance,
            "insertion_cost": calculate_insertion_cost(driver, prop_distance),
            "late_penalty": route_data["late_penalty_minutes"]
        }
    return {"is_match": False}

def check_m3_insertable(driver, route_data):
    is_pickup_near = route_data["dist_current_to_pickup"] <= MatchConfig.M3_PICKUP_MAX_KM
    is_dropoff_near = route_data["dist_pickup_to_dropoff"] <= MatchConfig.M3_DROPOFF_MAX_KM
    is_late_ok = route_data["late_penalty_minutes"] <= MatchConfig.M3_LATE_MAX_MINS

    if is_pickup_near and is_dropoff_near and route_data["is_same_direction"] and is_late_ok:
        prop_distance = route_data.get("prop_distance", 0)
        return {
            "is_match": True,
            "framework": "M3_INSERTABLE",
            "detour_distance": prop_distance,
            "insertion_cost": calculate_insertion_cost(driver, prop_distance),
            "late_penalty": route_data["late_penalty_minutes"]
        }
    return {"is_match": False}

def check_m4_return_to_depot(driver, route_data):
    if route_data.get("remaining_stop_count", 0) > 0:
        return {"is_match": False}

    prop_distance = (
        route_data["dist_current_to_pickup"] + 
        route_data["dist_pickup_to_dropoff"] + 
        route_data["dist_dropoff_to_depot"]
    ) - route_data["dist_current_to_depot"]

    if prop_distance <= MatchConfig.M4_BACKHAUL_DETOUR_MAX_KM and route_data["is_same_direction"]:
        return {
            "is_match": True,
            "framework": "M4_RETURN_TO_DEPOT",
            "detour_distance": prop_distance,
            "insertion_cost": calculate_insertion_cost(driver, prop_distance),
            "late_penalty": 0
        }
    return {"is_match": False}

def check_m5_cluster(driver, route_data):
    if not route_data.get("has_active_cluster", False):
        return {"is_match": False}

    is_pickup_in_cluster = route_data["dist_pickup_to_cluster"] <= MatchConfig.M5_CLUSTER_RADIUS_KM
    is_dropoff_in_cluster = route_data["dist_dropoff_to_cluster"] <= MatchConfig.M5_CLUSTER_RADIUS_KM
    is_late_ok = route_data["late_penalty_minutes"] <= MatchConfig.M5_LATE_MAX_MINS
    
    prop_distance = route_data.get("prop_distance", 0)
    is_detour_ok = prop_distance <= MatchConfig.M5_DETOUR_MAX_KM

    if is_pickup_in_cluster and is_dropoff_in_cluster and is_late_ok and is_detour_ok:
        return {
            "is_match": True,
            "framework": "M5_CLUSTER",
            "detour_distance": prop_distance,
            "insertion_cost": calculate_insertion_cost(driver, prop_distance),
            "late_penalty": route_data["late_penalty_minutes"]
        }
    return {"is_match": False}