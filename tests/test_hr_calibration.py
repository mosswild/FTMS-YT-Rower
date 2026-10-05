import unittest
from datetime import datetime, timezone
from fastapi.testclient import TestClient

from backend.main import app
import backend.hr_calibration as hr_calib
import backend.database as db


class TestHeartRateCalibration(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)
        db.init_db()

    def test_age_based_formulas(self):
        # Tanaka formula: 208 - (0.7 * age)
        # 30yo: 208 - 21 = 187
        self.assertEqual(hr_calib.calculate_age_based_max_hr(30, "tanaka"), 187)
        # 40yo: 208 - 28 = 180
        self.assertEqual(hr_calib.calculate_age_based_max_hr(40, "tanaka"), 180)
        # 50yo: 208 - 35 = 173
        self.assertEqual(hr_calib.calculate_age_based_max_hr(50, "tanaka"), 173)

        # Standard / Fox formula: 220 - age
        self.assertEqual(hr_calib.calculate_age_based_max_hr(30, "standard"), 190)
        self.assertEqual(hr_calib.calculate_age_based_max_hr(40, "fox"), 180)

        # Safety clamps
        self.assertGreaterEqual(hr_calib.calculate_age_based_max_hr(120), hr_calib.ABSOLUTE_MIN_HRMAX)
        self.assertLessEqual(hr_calib.calculate_age_based_max_hr(5), hr_calib.ABSOLUTE_MAX_HRMAX)

    def test_zone_calculations_for_max_hr(self):
        # Test zones for 200 HRmax
        zones = hr_calib.calculate_zones_for_max_hr(200)
        self.assertEqual(len(zones), 5)

        # Gray: 50% - 60%
        self.assertEqual(zones["1"]["name"], "Gray")
        self.assertEqual(zones["1"]["min_bpm"], 100)
        self.assertEqual(zones["1"]["max_bpm"], 120)
        self.assertFalse(zones["1"]["earns_splats"])

        # Blue: 61% - 70%
        self.assertEqual(zones["2"]["name"], "Blue")
        self.assertEqual(zones["2"]["min_bpm"], 122)
        self.assertEqual(zones["2"]["max_bpm"], 140)
        self.assertFalse(zones["2"]["earns_splats"])

        # Green: 71% - 83%
        self.assertEqual(zones["3"]["name"], "Green")
        self.assertEqual(zones["3"]["min_bpm"], 142)
        self.assertEqual(zones["3"]["max_bpm"], 166)
        self.assertFalse(zones["3"]["earns_splats"])

        # Orange: 84% - 91%
        self.assertEqual(zones["4"]["name"], "Orange")
        self.assertEqual(zones["4"]["min_bpm"], 168)
        self.assertEqual(zones["4"]["max_bpm"], 182)
        self.assertTrue(zones["4"]["earns_splats"])

        # Red: 92% - 100%
        self.assertEqual(zones["5"]["name"], "Red")
        self.assertEqual(zones["5"]["min_bpm"], 184)
        self.assertEqual(zones["5"]["max_bpm"], 200)
        self.assertTrue(zones["5"]["earns_splats"])

    def test_get_zone_for_bpm(self):
        max_hr = 200
        # Below zone 1
        z_low = hr_calib.get_zone_for_bpm(85, max_hr)
        self.assertEqual(z_low["zone"], 0)
        self.assertEqual(z_low["name"], "Rest")

        # In Zone 2 (Blue)
        z_blue = hr_calib.get_zone_for_bpm(130, max_hr)
        self.assertEqual(z_blue["zone"], 2)
        self.assertEqual(z_blue["name"], "Blue")
        self.assertFalse(z_blue["earns_splats"])

        # In Zone 4 (Orange - Splat zone)
        z_orange = hr_calib.get_zone_for_bpm(175, max_hr)
        self.assertEqual(z_orange["zone"], 4)
        self.assertEqual(z_orange["name"], "Orange")
        self.assertTrue(z_orange["earns_splats"])

        # In Zone 5 (Red - All out)
        z_red = hr_calib.get_zone_for_bpm(195, max_hr)
        self.assertEqual(z_red["zone"], 5)
        self.assertEqual(z_red["name"], "Red")
        self.assertTrue(z_red["earns_splats"])

    def test_spike_filtering_sustained_peak_hr(self):
        # 60 samples at steady 150, with a single 225 BPM optical sensor glitch
        samples = [{"elapsed_seconds": i, "hr": 150} for i in range(60)]
        samples[30]["hr"] = 225  # Glitch

        peak = hr_calib.calculate_sustained_peak_hr(samples)
        self.assertIsNotNone(peak)
        # Should be filtered down close to 150, ignoring the single 225 spike
        self.assertLess(peak, 160)

    def test_splat_points_and_session_zones(self):
        max_hr = 200  # Orange >= 168 BPM
        # 120 samples: 30s in Green (150 bpm) + 90s in Orange (170 bpm)
        samples = (
            [{"elapsed_seconds": i, "hr": 150} for i in range(30)] +
            [{"elapsed_seconds": 30 + i, "hr": 170} for i in range(90)]
        )
        res = hr_calib.calculate_session_zones_and_splats(samples, max_hr)
        # 90s in orange = 1 full minute (1 splat point)
        self.assertEqual(res["splat_points"], 1)
        self.assertGreater(res["splat_seconds"], 80)
        self.assertIn("4", res["zone_seconds"])

    def test_calibration_five_workout_trigger(self):
        # Create 4 qualifying workouts (needs 5)
        workouts = [
            {
                "id": f"w_{i}",
                "duration_seconds": 1200,
                "avg_hr": 145,
                "max_hr": 182,
                "sustained_peak_hr": 180 + i,
                "start_time": datetime.now(timezone.utc).isoformat(),
            }
            for i in range(4)
        ]

        active_hr, is_calibrated, raw = hr_calib.calibrate_max_hr(workouts, age=30, formula="tanaka")
        self.assertFalse(is_calibrated)
        # Should fall back to 30yo Tanaka (187)
        self.assertEqual(active_hr, 187)

        # Now add 5th workout
        workouts.append({
            "id": "w_4",
            "duration_seconds": 1500,
            "avg_hr": 152,
            "max_hr": 188,
            "sustained_peak_hr": 186,
            "start_time": datetime.now(timezone.utc).isoformat(),
        })

        active_hr_5, is_calibrated_5, raw_5 = hr_calib.calibrate_max_hr(workouts, age=30, formula="tanaka")
        self.assertTrue(is_calibrated_5)
        self.assertGreater(active_hr_5, 175)
        self.assertLess(active_hr_5, 200)

    def test_profile_api_endpoints(self):
        # 1. GET /api/profile
        res = self.client.get("/api/profile")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("profile", data)
        self.assertIn("active_max_hr", data)
        self.assertIn("zones", data)
        self.assertEqual(len(data["zones"]), 5)

        # 2. PUT /api/profile
        update_payload = {
            "name": "Rowing Champ",
            "age": 35,
            "formula": "tanaka",
            "calibration_mode": "manual",
            "manual_max_hr": 182,
        }
        res_put = self.client.put("/api/profile", json=update_payload)
        self.assertEqual(res_put.status_code, 200)
        put_data = res_put.json()
        self.assertEqual(put_data["profile"]["name"], "Rowing Champ")
        self.assertEqual(put_data["profile"]["age"], 35)
        self.assertEqual(put_data["active_max_hr"], 182)

        # 3. POST /api/profile/recalibrate
        res_recal = self.client.post("/api/profile/recalibrate")
        self.assertEqual(res_recal.status_code, 200)
        recal_data = res_recal.json()
        self.assertIn("active_max_hr", recal_data)
        self.assertIn("zones", recal_data)


if __name__ == "__main__":
    unittest.main()
