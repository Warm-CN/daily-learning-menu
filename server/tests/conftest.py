import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import User, create_app, create_defaults, db, initialize_database


@pytest.fixture()
def app():
    application = create_app({
        "TESTING": True,
        "WTF_CSRF_ENABLED": False,
        "RATELIMIT_ENABLED": False,
        "SQLALCHEMY_DATABASE_URI": "sqlite://",
        "SECRET_KEY": "test-secret",
        "REMEMBER_COOKIE_SECURE": False,
        "SESSION_COOKIE_SECURE": False,
    })
    with application.app_context():
        initialize_database()
    yield application
    with application.app_context():
        db.session.remove()
        db.drop_all()


@pytest.fixture()
def client(app):
    return app.test_client()


def approve_user(app, username):
    with app.app_context():
        user = db.session.scalar(db.select(User).where(User.username_key == username.casefold()))
        user.is_approved = True
        create_defaults(user.id)
        db.session.commit()
        return user.id


def register(client, username, password="password123", approve=True):
    response = client.post("/register", data={"username": username, "password": password, "remember": "y"},
                           follow_redirects=False)
    if approve:
        approve_user(client.application, username)
        login = client.post("/login", data={"username": username, "password": password, "remember": "y"},
                            follow_redirects=False)
        assert login.status_code == 302
    return response
