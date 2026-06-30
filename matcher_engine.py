from matching_frameworks import *
from catboost import CatBoostClassifier
import pandas as pd

SYSTEM_PHASE = 1  # 1 = Rule-Based, 2 = ML Model

MODEL_PATH = r"./ML Model/marketplace_matching.cbm"
ml_model = CatBoostClassifier()
ml_model.load_model(MODEL_PATH)

def calculate_rule_based_score(match_result):
    framework = match_result.get("framework")
    
    # Base Score
    base_scores = {
        "M1_ON_ROUTE": 95,
        "M4_RETURN_TO_DEPOT": 95,
        "M2_NEAR_CURRENT": 85,
        "M3_INSERTABLE": 80,
        "M5_CLUSTER": 75
    }
    base_score = base_scores.get(framework, 50)
    
    # Penalty Deductions
    detour_penalty = match_result.get("detour_distance", 0) * 0.2
    late_penalty = match_result.get("late_penalty", 0) * 0.5
    
    # Net Score (Limit 0-100)
    final_score = base_score - detour_penalty - late_penalty
    return round(max(0, min(100, final_score)), 1)

# prepare features for input ml model 
def prepare_features_for_ml(driver, route_data, match_result):
    framework_mapping = {
        "M1_ON_ROUTE": 1,
        "M2_NEAR_CURRENT": 2,
        "M3_INSERTABLE": 3,
        "M4_RETURN_TO_DEPOT": 4,
        "M5_CLUSTER": 5
    }

    matched_fw_code = framework_mapping.get(match_result.get("framework"), 1)
    hist_fw_code = driver.get("historical_framework_preference", 1)

    fw_match = 1 if matched_fw_code == hist_fw_code else 0


    # feature list ห้ามแก้ไขลำดับและข้อมูลเด็ดขาด
    # ให้ uncomment และเพิ่มการเรียกข้อมูลที่ด้านหลัง : ของแต่ละ feature เท่านั้น (ดูคำอธิบายแต่ละตัวแปรที่เอกสาร SRS)
    # หากจะใช้งาน ML Model ให้เปลี่ยน SYSTEM_PHASE เป็น 2
    features = {
        # "historical_accept_rate": ,
        # "historical_cancel_rate": ,
        # "historical_framework_preference": hist_fw_code,
        # "matched_framework": matched_fw_code,
        # "framework_match": fw_match,
        # "has_rejected_this_job": ,
        # "fatigue_level": ,
        # "earnings_today": ,
        # "idle_time_minutes": ,
        
        # "hour_of_day": ,
        
        # "current_load_utilization": ,
        # "route_completion_ratio": ,
        # "is_returning": ,

        # "distance_to_home_depot": ,
        # "pickup_detour_km": ,
        # "total_detour_km": ,
        # "eta_delay_minutes": ,
        # "estimated_fuel_cost": ,
        # "expected_margin": ,
        # "margin_per_km": ,

        # "nearby_driver_count": ,
        # "marketplace_job_density": ,
        # "supply_demand_ratio": 
    }

    return pd.DataFrame([features])

def evaluate_driver_match(driver, route_data):
    possible_matches = []
    
    m1 = check_m1_on_route(driver, route_data)
    if m1["is_match"]: possible_matches.append(m1)
        
    m2 = check_m2_near_current(driver, route_data)
    if m2["is_match"]: possible_matches.append(m2)
        
    m3 = check_m3_insertable(driver, route_data)
    if m3["is_match"]: possible_matches.append(m3)
        
    m4 = check_m4_return_to_depot(driver, route_data)
    if m4["is_match"]: possible_matches.append(m4)
        
    m5 = check_m5_cluster(driver, route_data)
    if m5["is_match"]: possible_matches.append(m5)

    if not possible_matches:
        return {"is_match": False, "score_pct": 0, "framework_used": None}
    
    for match in possible_matches:
        if SYSTEM_PHASE == 1:
            match["score_pct"] = calculate_rule_based_score(match)

        elif SYSTEM_PHASE == 2:
            input_df = prepare_features_for_ml(driver, route_data, match)
            prob_accept = ml_model.predict_proba(input_df)[0][1] 
            match["score_pct"] = round(prob_accept * 100, 1)

    best_match = max(possible_matches, key=lambda x: x["score_pct"])
    best_match["framework_used"] = best_match["framework"]

    return best_match

def score_all_drivers_for_job(job, filtered_drivers, route_data_map):
    results = []
    
    for driver in filtered_drivers:
        driver_id = driver["id"]
        route_data = route_data_map.get(driver_id, {})
        match_result = evaluate_driver_match(driver, route_data)
        
        results.append({
            "driver_id": driver_id,
            "driver_name": driver.get("name", "Unknown"),
            "is_match": match_result["is_match"],
            "smart_match_pct": match_result.get("score_pct", 0),
            "framework_used": match_result.get("framework_used"),
            "has_rejected_this_job": driver.get("has_rejected_this_job", False)
        })

    matched_candidates = [r for r in results if r["is_match"]]
    
    def sort_logic(x):
        return (x["has_rejected_this_job"], -x["smart_match_pct"])
        
    matched_candidates.sort(key=sort_logic)
    return matched_candidates