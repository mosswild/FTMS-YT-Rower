import unittest
from fastapi.testclient import TestClient

from backend.database import init_db, save_track, save_user_profile, delete_user_profile
from backend.quick_workouts_manager import ensure_default_quick_workouts
from backend.main import app


class TestQuickWorkouts(unittest.TestCase):
    def setUp(self):
        init_db()
        from backend.database import get_db_connection
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM quick_workouts")
        try:
            cursor.execute("DELETE FROM app_metadata WHERE key = 'default_quick_workouts_seeded'")
        except Exception:
            pass
        conn.commit()
        conn.close()

        # Seed test tracks if needed
        save_track({
            "id": "test-track-glacier",
            "name": "Glacier Lagoon",
            "video_id": "test_video_123",
            "start_time": 0.0,
            "end_time": 600.0,
            "fixed_speed": False
        })
        # Seed test athlete
        save_user_profile({
            "id": "athlete_custom_test",
            "name": "Custom Athlete",
            "age": 28
        })
        ensure_default_quick_workouts()
        self.client = TestClient(app)

    def tearDown(self):
        try:
            delete_user_profile("athlete_custom_test")
        except Exception:
            pass
        from backend.database import get_db_connection
        conn = get_db_connection()
        cursor = conn.cursor()
        cursor.execute("DELETE FROM quick_workouts")
        try:
            cursor.execute("DELETE FROM app_metadata WHERE key = 'default_quick_workouts_seeded'")
        except Exception:
            pass
        conn.commit()
        conn.close()
        ensure_default_quick_workouts()

    def test_list_default_cards(self):
        resp = self.client.get("/api/quick-workouts")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("cards", data)
        self.assertGreaterEqual(len(data["cards"]), 3)
        card_ids = [c["id"] for c in data["cards"]]
        self.assertNotIn("glacier-lake-primer", card_ids)
        self.assertIn("thames-zone2-cruise", card_ids)
        self.assertIn("fast-water-hiit", card_ids)
        self.assertIn("classic-2k-benchmark", card_ids)

        # Check enrichment
        thames = next(c for c in data["cards"] if c["id"] == "thames-zone2-cruise")
        self.assertTrue(thames["is_default"])
        self.assertEqual(thames["workout_id"], "30m-zone2-aerobic-base")

    def test_create_and_manage_custom_card(self):
        # Create custom card
        custom_payload = {
            "user_id": "athlete_custom_test",
            "title": "My Favorite Interval Row",
            "description": "Custom HIIT with Glacier Lagoon",
            "track_id": "test-track-glacier",
            "workout_id": "tabata_sprints"
        }
        create_resp = self.client.post("/api/quick-workouts", json=custom_payload)
        self.assertEqual(create_resp.status_code, 200)
        created_card = create_resp.json()["card"]
        self.assertEqual(created_card["title"], "My Favorite Interval Row")
        self.assertFalse(created_card["is_default"])
        self.assertEqual(created_card["user_id"], "athlete_custom_test")
        card_id = created_card["id"]

        # Fetch with user_id
        user_list = self.client.get("/api/quick-workouts?user_id=athlete_custom_test").json()
        self.assertTrue(any(c["id"] == card_id for c in user_list["cards"]))

        # Fetch single card
        single_resp = self.client.get(f"/api/quick-workouts/{card_id}")
        self.assertEqual(single_resp.status_code, 200)
        self.assertEqual(single_resp.json()["id"], card_id)

        # Update card
        update_payload = {
            "title": "Updated Interval Row",
            "description": "Updated description",
            "track_id": "test-track-glacier",
            "workout_id": "tabata_sprints"
        }
        put_resp = self.client.put(f"/api/quick-workouts/{card_id}", json=update_payload)
        self.assertEqual(put_resp.status_code, 200)
        self.assertEqual(put_resp.json()["card"]["title"], "Updated Interval Row")

        # Deleting default card should now succeed
        del_default = self.client.delete("/api/quick-workouts/thames-zone2-cruise")
        self.assertEqual(del_default.status_code, 200)
        self.assertTrue(del_default.json()["deleted"])

        # Deleting custom card should succeed
        del_custom = self.client.delete(f"/api/quick-workouts/{card_id}")
        self.assertEqual(del_custom.status_code, 200)
        self.assertTrue(del_custom.json()["deleted"])

        # Verify custom card deleted
        get_deleted = self.client.get(f"/api/quick-workouts/{card_id}")
        self.assertEqual(get_deleted.status_code, 404)
