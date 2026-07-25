from datetime import timedelta

from app import (ActiveTimer, OwnedPokemon, PokemonProfile, PokemonReward, User, db,
                 POKEMON_MAX_XP_SECONDS, EEVEE_BRANCH_XP_SECONDS)
from conftest import register


def payload(response):
    body = response.get_json()
    assert body["ok"], body
    return body["data"]


def choose_first_partner(client):
    state = payload(client.post("/api/pokemon/bootstrap"))
    choice = state["pendingCandidates"][0]
    return payload(client.post("/api/pokemon/claim", json={"baseSpeciesId": choice,
                                                            "stateVersion": state["stateVersion"]}))


def test_version_preference_is_validated_and_remembered(app, client):
    register(client, "version_user")
    changed = payload(client.patch("/api/preferences/version", json={"version": "pokemon"}))
    assert changed == {"version": "pokemon", "url": "/pokemon"}
    assert client.get("/pokemon").status_code == 200
    assert 'data-app-version="pokemon" class="active"' in client.get("/friends").get_data(as_text=True)
    assert client.patch("/api/preferences/version", json={"version": "unknown"}).status_code == 400
    client.post("/logout")
    response = client.post("/login", data={"username": "version_user", "password": "password123"})
    assert response.headers["Location"].endswith("/pokemon")


def test_candidates_are_persisted_and_claim_is_server_validated(app, client):
    register(client, "starter_user")
    first = payload(client.post("/api/pokemon/bootstrap"))
    second = payload(client.post("/api/pokemon/bootstrap"))
    assert len(first["pendingCandidates"]) == 3
    assert second["pendingCandidates"] == first["pendingCandidates"]
    assert client.post("/api/pokemon/claim", json={"baseSpeciesId": 2}).status_code == 409
    stale = client.post("/api/pokemon/claim", json={"baseSpeciesId": first["pendingCandidates"][0],
                                                     "stateVersion": first["stateVersion"] - 1})
    assert stale.status_code == 409 and stale.get_json()["error"]["code"] == "stale_pokemon"
    selected = payload(client.post("/api/pokemon/claim",
                                   json={"baseSpeciesId": first["pendingCandidates"][0],
                                         "stateVersion": first["stateVersion"]}))
    assert selected["currentPokemonId"]
    assert selected["pendingCandidates"] == []
    assert client.post("/api/pokemon/claim",
                       json={"baseSpeciesId": first["pendingCandidates"][1]}).status_code == 409


def test_completed_timer_awards_exactly_once(app, client):
    register(client, "reward_user")
    selected = choose_first_partner(client)
    pokemon_id = selected["currentPokemonId"]
    started = payload(client.post("/api/timer/start", json={"projectId": "math", "mode": "countup"}))
    with app.app_context():
        timer = db.session.get(ActiveTimer, 1)
        timer.segment_started_at -= timedelta(hours=1)
        timer.session_started_at -= timedelta(hours=1)
        db.session.commit()
    stopped = payload(client.post("/api/timer/stop", json={"sessionId": started["sessionId"],
                                                            "version": started["version"]}))
    payload(client.post("/api/timer/stop", json={"sessionId": started["sessionId"],
                                                  "version": started["version"]}))
    state = payload(client.post("/api/pokemon/bootstrap"))
    owned = next(item for item in state["owned"] if item["id"] == pokemon_id)
    assert abs(owned["experienceSeconds"] - stopped["durationSeconds"]) <= 1
    with app.app_context():
        assert db.session.scalar(db.select(db.func.count()).select_from(PokemonReward)) == 1


def test_reward_waits_without_partner_and_overflow_is_preserved(app, client):
    register(client, "overflow_user")
    started = payload(client.post("/api/timer/start", json={"projectId": "math", "mode": "countup"}))
    with app.app_context():
        timer = db.session.get(ActiveTimer, 1)
        timer.segment_started_at -= timedelta(hours=2)
        timer.session_started_at -= timedelta(hours=2)
        db.session.commit()
    payload(client.post("/api/timer/stop", json={"sessionId": started["sessionId"],
                                                  "version": started["version"]}))
    waiting = payload(client.post("/api/pokemon/bootstrap"))
    assert waiting["unspentXpSeconds"] >= 7199
    claimed = payload(client.post("/api/pokemon/claim",
                                  json={"baseSpeciesId": waiting["pendingCandidates"][0],
                                        "stateVersion": waiting["stateVersion"]}))
    assert claimed["owned"][0]["experienceSeconds"] >= 7199
    with app.app_context():
        owned = db.session.get(OwnedPokemon, claimed["currentPokemonId"])
        owned.experience_seconds = POKEMON_MAX_XP_SECONDS - 1800
        profile = db.session.get(PokemonProfile, 1)
        profile.unspent_xp_seconds = 3600
        from app import apply_unspent_pokemon_xp
        apply_unspent_pokemon_xp(profile)
        db.session.commit()
        assert owned.graduated
        assert profile.unspent_xp_seconds == 1800


def test_eevee_pauses_at_branch_and_resumes_after_choice(app, client):
    register(client, "eevee_user")
    with app.app_context():
        profile = PokemonProfile(user_id=1, unspent_xp_seconds=3600)
        eevee = OwnedPokemon(user_id=1, base_species_id=133,
                             experience_seconds=EEVEE_BRANCH_XP_SECONDS)
        db.session.add_all([profile, eevee]); db.session.flush()
        profile.current_pokemon_id = eevee.id
        db.session.commit()
        pokemon_id = eevee.id
    before = payload(client.post("/api/pokemon/bootstrap"))
    evolved = payload(client.post("/api/pokemon/evolve",
                                  json={"pokemonId": pokemon_id, "targetSpeciesId": 135,
                                        "stateVersion": before["stateVersion"]}))
    current = next(item for item in evolved["owned"] if item["id"] == pokemon_id)
    assert current["evolvedSpeciesId"] == 135
    assert current["experienceSeconds"] == EEVEE_BRANCH_XP_SECONDS + 3600
    assert evolved["unspentXpSeconds"] == 0


def test_manual_and_imported_study_do_not_award_experience(app, client):
    register(client, "no_reward_user")
    choose_first_partner(client)
    assert client.put("/api/study/day/2026-07-24", json={"durations": {"math": 3600}}).status_code == 200
    bundle = payload(client.get("/api/bootstrap"))
    imported = {"format": "kaoyan-study-backup", "version": 1,
                "study": {"2026-07-24": {"math": 7200}},
                "sessions": [{"id": "imported-session", "subject": "math", "startedAt": 0,
                              "endedAt": 7200000, "durationSec": 7200}],
                "milestones": {}, "projects": bundle["projects"]}
    assert client.post("/api/data/import", json=imported).status_code == 200
    state = payload(client.post("/api/pokemon/bootstrap"))
    assert sum(item["experienceSeconds"] for item in state["owned"]) == 0
    with app.app_context():
        assert db.session.scalar(db.select(db.func.count()).select_from(PokemonReward)) == 0


def test_pokemon_backup_restores_cloud_progress(app, client):
    register(client, "pokemon_backup")
    selected = choose_first_partner(client)
    exported = payload(client.get("/api/bootstrap"))
    assert exported["pokemon"]["currentPokemonId"] == selected["currentPokemonId"]
    assert client.post("/api/data/import", json=exported).status_code == 200
    restored = payload(client.post("/api/pokemon/bootstrap"))
    assert len(restored["owned"]) == 1
    assert restored["currentPokemonId"] is not None


def test_backup_without_pokemon_still_restores_version_preference(app, client):
    register(client, "preference_backup")
    client.patch("/api/preferences/version", json={"version": "pokemon"})
    backup = payload(client.get("/api/bootstrap"))
    assert "pokemon" not in backup and backup["preferredVersion"] == "pokemon"
    client.patch("/api/preferences/version", json={"version": "classic"})
    assert client.post("/api/data/import", json=backup).status_code == 200
    with app.app_context():
        assert db.session.get(User, 1).preferred_version == "pokemon"


def test_import_rejects_duplicate_and_locked_pokemon(app, client):
    register(client, "invalid_poke_backup")
    backup = payload(client.get("/api/bootstrap"))
    backup["pokemon"] = {"stateVersion": 1, "currentPokemonId": 1, "unspentXpSeconds": 0,
        "pendingCandidates": [], "rewards": [], "owned": [
            {"id": 1, "baseSpeciesId": 1, "experienceSeconds": 0, "graduated": False},
            {"id": 2, "baseSpeciesId": 1, "experienceSeconds": 0, "graduated": False},
        ]}
    assert client.post("/api/data/import", json=backup).status_code == 400
    backup["pokemon"]["owned"] = [
        {"id": 1, "baseSpeciesId": 150, "experienceSeconds": 0, "graduated": False},
    ]
    assert client.post("/api/data/import", json=backup).status_code == 400
    backup["pokemon"]["owned"] = [
        {"id": 1, "baseSpeciesId": 1, "experienceSeconds": 3600, "graduated": False},
    ]
    assert client.post("/api/data/import", json=backup).status_code == 400
    with app.app_context():
        assert db.session.scalar(db.select(db.func.count()).select_from(OwnedPokemon)) == 0
