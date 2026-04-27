from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_returns_ok():
    response = client.get("/v1/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_root_returns_app_status():
    response = client.get("/")
    assert response.status_code == 200
    assert response.json() == {"app": "intempo", "status": "ok"}
