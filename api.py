# api.py
from fastapi import FastAPI
from pydantic import BaseModel
from matcher_engine import score_all_drivers_for_job

app = FastAPI()

class MatchRequest(BaseModel):
    job: dict
    filtered_drivers: list
    route_data_map: dict

@app.post("/api/calculate-match")
def calculate_match(request: MatchRequest):
    results = score_all_drivers_for_job(
        job=request.job,
        filtered_drivers=request.filtered_drivers,
        route_data_map=request.route_data_map
    )
    
    return {"success": True, "data": results}

# วิธีรันเซิร์ฟเวอร์: uvicorn api:app --reload --port 8000