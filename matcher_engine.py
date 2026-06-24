from matching_frameworks import *

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

    best_match = possible_matches[0]
    
    final_score_pct = 0
    if MatchConfig.SYSTEM_PHASE == 1:
        final_score_pct = calculate_rule_based_score(best_match)

    elif MatchConfig.SYSTEM_PHASE == 2:
        # TODO: ใส่ฟังก์ชันเรียก ML Model ในอนาคต
        pass

    best_match.update({
        "score_pct": final_score_pct,
        "framework_used": best_match["framework"]
    })
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