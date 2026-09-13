import os
import unittest
from fastapi.testclient import TestClient

from backend.main import app
import backend.workout_manager as workout_mgr

class TestWorkoutFramework(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        workout_mgr.ensure_workout_directories()

    def test_duration_parsing(self):
        self.assertEqual(workout_mgr.parse_duration_to_seconds(120), 120.0)
        self.assertEqual(workout_mgr.parse_duration_to_seconds("5m"), 300.0)
        self.assertEqual(workout_mgr.parse_duration_to_seconds("90s"), 90.0)
        self.assertEqual(workout_mgr.parse_duration_to_seconds("4m30s"), 270.0)
        self.assertEqual(workout_mgr.parse_duration_to_seconds("1h"), 3600.0)
        self.assertEqual(workout_mgr.parse_duration_to_seconds("02:30"), 150.0)

    def test_distance_parsing(self):
        self.assertEqual(workout_mgr.parse_distance_to_meters(500), 500.0)
        self.assertEqual(workout_mgr.parse_distance_to_meters("500m"), 500.0)
        self.assertEqual(workout_mgr.parse_distance_to_meters("2km"), 2000.0)
        self.assertEqual(workout_mgr.parse_distance_to_meters("5k"), 5000.0)

    def test_split_parsing(self):
        self.assertEqual(workout_mgr.parse_split_to_seconds("2:00"), 120.0)
        self.assertEqual(workout_mgr.parse_split_to_seconds("1:45"), 105.0)

    def test_list_builtin_workouts(self):
        workouts = workout_mgr.list_workouts()
        self.assertGreaterEqual(len(workouts), 5)
        ids = [w["id"] for w in workouts]
        self.assertIn("5x500m-power-intervals", ids)
        self.assertIn("4x1000m-aerobic-threshold", ids)
        self.assertIn("distance-pyramid-sprint", ids)
        self.assertIn("5k-rate-ladder", ids)
        self.assertIn("tabata-sprints", ids)

    def test_get_workout_details(self):
        w = workout_mgr.get_workout("5x500m-power-intervals")
        self.assertIsNotNone(w)
        self.assertEqual(w["title"], "5 x 500m Power Intervals")
        self.assertEqual(w["category"], "intervals")
        self.assertEqual(w["difficulty"], "advanced")
        # 1 warmup + 5*(work+rest) + 1 cooldown = 12 steps
        self.assertEqual(len(w["expanded_steps"]), 12)
        first_step = w["expanded_steps"][0]
        self.assertEqual(first_step["type"], "warmup")
        self.assertEqual(first_step["exit"]["duration"], 300.0)
        second_step = w["expanded_steps"][1]
        self.assertEqual(second_step["type"], "work")
        self.assertEqual(second_step["exit"]["distance"], 500.0)
        self.assertEqual(second_step["targets"]["spm"], [28.0, 32.0])

    def test_api_list_and_get(self):
        res = self.client.get("/api/workouts")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("workouts", data)
        self.assertGreaterEqual(len(data["workouts"]), 5)

        res_single = self.client.get("/api/workouts/5x500m-power-intervals")
        self.assertEqual(res_single.status_code, 200)
        single_data = res_single.json()
        self.assertEqual(single_data["id"], "5x500m-power-intervals")
        self.assertIn("expanded_steps", single_data)

        # Test download YAML
        res_yaml = self.client.get("/api/workouts/5x500m-power-intervals/yaml")
        self.assertEqual(res_yaml.status_code, 200)
        self.assertIn("schema:", res_yaml.text)

    def test_custom_workout_lifecycle(self):
        custom_yaml = """schema: "1.0"
id: "unit-test-custom"
title: "Unit Test Custom Workout"
category: "recovery"
difficulty: "beginner"
segments:
  - type: "warmup"
    title: "Gentle Spin"
    exit: { duration: "3m" }
    targets: { spm: [18, 20] }
  - type: "work"
    title: "Cruising"
    exit: { distance: "1000m" }
    targets: { spm: [20, 22] }
"""
        # Create
        res_post = self.client.post("/api/workouts", json={"yaml": custom_yaml})
        self.assertEqual(res_post.status_code, 200)
        post_data = res_post.json()
        self.assertEqual(post_data["status"], "saved")
        self.assertEqual(post_data["workout"]["id"], "unit-test-custom")

        # Get
        res_get = self.client.get("/api/workouts/unit-test-custom")
        self.assertEqual(res_get.status_code, 200)
        self.assertEqual(res_get.json()["title"], "Unit Test Custom Workout")

        # Delete
        res_del = self.client.delete("/api/workouts/unit-test-custom")
        self.assertEqual(res_del.status_code, 200)
        self.assertTrue(res_del.json()["deleted"])

        # Confirm deleted
        res_get_del = self.client.get("/api/workouts/unit-test-custom")
        self.assertEqual(res_get_del.status_code, 404)

    def test_protect_builtin_deletion(self):
        res_del = self.client.delete("/api/workouts/5x500m-power-intervals")
        self.assertEqual(res_del.status_code, 400)
        self.assertIn("Built-in workouts are read-only", res_del.json()["detail"])

if __name__ == "__main__":
    unittest.main()
