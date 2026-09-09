import os
import unittest
import tempfile
import xml.etree.ElementTree as ET
from fastapi.testclient import TestClient

from backend.database import init_db, save_workout, get_workout, list_workouts, delete_workout
from backend.tcx_generator import generate_tcx
from backend.main import app
from backend.streaming import parse_range_header

class TestBackendAndFormulas(unittest.TestCase):
    def setUp(self):
        init_db()
        self.client = TestClient(app)

    def test_power_formula(self):
        # Watts = 2.80 / (pace_in_sec_per_meter ^ 3)
        # For a 2:00 / 500m split (120 seconds):
        # pace_in_sec_per_meter = 120 / 500 = 0.24
        # watts = 2.80 / (0.24 ** 3) = 2.80 / 0.013824 = 202.546...
        split_seconds = 120.0
        sec_per_meter = split_seconds / 500.0
        watts = 2.80 / (sec_per_meter ** 3)
        self.assertAlmostEqual(watts, 202.546, places=2)

    def test_database_crud(self):
        test_id = "test-workout-123"
        workout_data = {
            "id": test_id,
            "start_time": "2026-09-08T12:00:00Z",
            "end_time": "2026-09-08T12:30:00Z",
            "duration_seconds": 1800,
            "distance_meters": 5000.0,
            "total_strokes": 650,
            "avg_spm": 22.5,
            "avg_split": 108.0,
            "avg_watts": 210.0,
            "max_watts": 280.0,
            "avg_hr": 145.0,
            "video_id": "test_video",
            "audio_source": "original",
            "notes": "Great morning session"
        }
        samples = [
            {"elapsed_seconds": 1.0, "stroke_rate": 20, "split_seconds": 115.0, "watts": 190.0, "hr": 130.0, "distance": 2.5},
            {"elapsed_seconds": 2.0, "stroke_rate": 22, "split_seconds": 110.0, "watts": 205.0, "hr": 135.0, "distance": 5.2},
        ]
        
        saved_id = save_workout(workout_data, samples)
        self.assertEqual(saved_id, test_id)

        fetched = get_workout(test_id)
        self.assertIsNotNone(fetched)
        self.assertEqual(fetched["distance_meters"], 5000.0)
        self.assertEqual(len(fetched["samples"]), 2)
        self.assertEqual(fetched["samples"][0]["stroke_rate"], 20.0)

        all_workouts = list_workouts()
        self.assertTrue(any(w["id"] == test_id for w in all_workouts))

        deleted = delete_workout(test_id)
        self.assertTrue(deleted)
        self.assertIsNone(get_workout(test_id))

    def test_tcx_generation(self):
        workout_data = {
            "id": "tcx-test",
            "start_time": "2026-09-08T10:00:00Z",
            "duration_seconds": 1200,
            "distance_meters": 4000.0,
            "avg_spm": 24,
            "avg_watts": 215.0,
            "avg_hr": 150,
            "max_hr": 165,
            "samples": [
                {"elapsed_seconds": 0.0, "stroke_rate": 20, "split_seconds": 120.0, "watts": 202.0, "hr": 130, "distance": 0.0},
                {"elapsed_seconds": 10.0, "stroke_rate": 24, "split_seconds": 110.0, "watts": 220.0, "hr": 140, "distance": 45.0},
            ]
        }
        xml_str = generate_tcx(workout_data)
        self.assertIn("TrainingCenterDatabase", xml_str)
        self.assertIn('Sport="Rowing"', xml_str)
        self.assertIn("<DistanceMeters>4000.0</DistanceMeters>", xml_str)
        self.assertIn("<Cadence>24</Cadence>", xml_str)
        self.assertIn("<Watts>220</Watts>", xml_str)

        # Parse XML to verify well-formedness
        root = ET.fromstring(xml_str)
        self.assertEqual(root.tag.split("}")[-1], "TrainingCenterDatabase")

    def test_range_header_parsing(self):
        file_size = 1000
        start, end = parse_range_header("bytes=0-499", file_size)
        self.assertEqual((start, end), (0, 499))

        start, end = parse_range_header("bytes=500-", file_size)
        self.assertEqual((start, end), (500, 999))

        start, end = parse_range_header("bytes=-200", file_size)
        self.assertEqual((start, end), (800, 999))

    def test_api_endpoints(self):
        # Test /api/library endpoint
        resp = self.client.get("/api/library")
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertIn("videos", data)
        self.assertIn("audio", data)

        # Test /api/sessions endpoint
        resp = self.client.get("/api/sessions")
        self.assertEqual(resp.status_code, 200)

        # Test creating a session via API
        payload = {
            "id": "api-session-1",
            "start_time": "2026-09-08T14:00:00Z",
            "duration_seconds": 600,
            "distance_meters": 2000.0,
            "total_strokes": 240,
            "avg_spm": 24.0,
            "avg_split": 115.0,
            "avg_watts": 200.0,
            "max_watts": 250.0,
            "avg_hr": 140.0,
            "samples": [
                {"elapsed_seconds": 1.0, "stroke_rate": 24, "split_seconds": 115.0, "watts": 200.0, "hr": 140.0, "distance": 5.0}
            ]
        }
        post_resp = self.client.post("/api/sessions", json=payload)
        self.assertEqual(post_resp.status_code, 200)
        self.assertEqual(post_resp.json()["id"], "api-session-1")

        # Test TCX export endpoint
        tcx_resp = self.client.get("/api/sessions/api-session-1/export/tcx")
        self.assertEqual(tcx_resp.status_code, 200)
        self.assertIn("TrainingCenterDatabase", tcx_resp.text)

        # Cleanup
        del_resp = self.client.delete("/api/sessions/api-session-1")
        self.assertEqual(del_resp.status_code, 200)

    def test_track_crud(self):
        payload = {
            "name": "Test Sprint Track",
            "video_id": "test_video_123",
            "start_time": 15.0,
            "end_time": 90.0,
            "default_audio": "original",
            "allowed_audios": ["test_audio_1", "test_audio_2"],
            "notes": "Fast sprint section"
        }
        res = self.client.post("/api/tracks", json=payload)
        self.assertEqual(res.status_code, 200)
        track_id = res.json()["id"]

        # Fetch single track
        get_res = self.client.get(f"/api/tracks/{track_id}")
        self.assertEqual(get_res.status_code, 200)
        data = get_res.json()
        self.assertEqual(data["name"], "Test Sprint Track")
        self.assertEqual(data["start_time"], 15.0)
        self.assertEqual(data["end_time"], 90.0)
        self.assertEqual(len(data["allowed_audios"]), 2)

        # List tracks
        list_res = self.client.get("/api/tracks")
        self.assertEqual(list_res.status_code, 200)
        self.assertTrue(any(t["id"] == track_id for t in list_res.json()["tracks"]))

        # Delete track
        del_res = self.client.delete(f"/api/tracks/{track_id}")
        self.assertEqual(del_res.status_code, 200)

    def test_media_upload(self):
        import subprocess
        # 1. Test Audio Upload
        tmp_mp3 = tempfile.mktemp(suffix=".mp3")
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
            "-t", "1", "-q:a", "9", tmp_mp3
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

        with open(tmp_mp3, "rb") as f:
            res = self.client.post(
                "/api/media/upload",
                files={"file": ("norway_fjords.mp3", f, "audio/mpeg")},
                data={"media_type": "audio", "title": "Norway Fjords Ambient"}
            )
        os.remove(tmp_mp3)

        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["status"], "success")
        self.assertEqual(data["media_type"], "audio")
        self.assertEqual(data["title"], "Norway Fjords Ambient")
        self.assertGreaterEqual(data["duration"], 0.9)
        audio_id = data["id"]

        # Verify in library
        lib_res = self.client.get("/api/library")
        self.assertEqual(lib_res.status_code, 200)
        audios = lib_res.json().get("audio", [])
        self.assertTrue(any(a["id"] == audio_id for a in audios))

        # Cleanup audio
        del_res = self.client.delete(f"/api/media/audio/{audio_id}")
        self.assertEqual(del_res.status_code, 200)

        # 2. Test Video Upload
        tmp_mp4 = tempfile.mktemp(suffix=".mp4")
        subprocess.run([
            "ffmpeg", "-y", "-f", "lavfi", "-i", "color=c=blue:s=64x64:d=1",
            "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
            "-t", "1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac",
            tmp_mp4
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)

        with open(tmp_mp4, "rb") as f:
            res_v = self.client.post(
                "/api/media/upload",
                files={"file": ("lake_bled_sprint.mp4", f, "video/mp4")},
                data={"media_type": "video", "title": "Lake Bled Sprint"}
            )
        os.remove(tmp_mp4)

        self.assertEqual(res_v.status_code, 200)
        data_v = res_v.json()
        self.assertEqual(data_v["status"], "success")
        self.assertEqual(data_v["media_type"], "video")
        self.assertEqual(data_v["title"], "Lake Bled Sprint")
        video_id = data_v["id"]

        # Verify in library
        lib_res = self.client.get("/api/library")
        self.assertEqual(lib_res.status_code, 200)
        videos = lib_res.json().get("videos", [])
        self.assertTrue(any(v["id"] == video_id for v in videos))

        # Cleanup video
        del_v_res = self.client.delete(f"/api/media/video/{video_id}")
        self.assertEqual(del_v_res.status_code, 200)

if __name__ == "__main__":
    unittest.main()

