from __future__ import annotations

from pathlib import Path

from e2e.config import Keys, load_keys, parse_env_file


def test_parse_env_file(tmp_path: Path) -> None:
    f = tmp_path / "x.env"
    f.write_text("# c\nSARVAM_API_KEY='abc'\nexport VOICE_LLM_MODEL=\"m\"\nEMPTY=\nnot a line\n")
    assert parse_env_file(f) == {"SARVAM_API_KEY": "abc", "VOICE_LLM_MODEL": "m", "EMPTY": ""}
    assert parse_env_file(tmp_path / "missing.env") == {}


def test_override_wins_field_by_field_and_api_key_is_ignored(tmp_path: Path) -> None:
    base = tmp_path / "home.env"
    base.write_text("SARVAM_API_KEY=s1\nANTHROPIC_ORGANIZATION_ID=org\nANTHROPIC_FEDERATION_RULE_ID=rule\n"
                    "ANTHROPIC_IDENTITY_TOKEN_FILE=/tmp/t\nANTHROPIC_API_KEY=sk-should-be-ignored\n")
    over = tmp_path / ".env.e2e.local"
    over.write_text("SARVAM_API_KEY=s2\nANTHROPIC_ORGANIZATION_ID=\n")
    k = load_keys(base, over)
    assert k.sarvam == "s2"
    assert k.wif["ANTHROPIC_ORGANIZATION_ID"] == "org"  # an empty override doesn't erase
    assert "ANTHROPIC_API_KEY" not in k.claude_env()
    assert k.claude_ready


def test_repr_never_shows_values() -> None:
    k = Keys(sarvam="secret-sarvam", wif={"ANTHROPIC_FEDERATION_RULE_ID": "r", "ANTHROPIC_ORGANIZATION_ID": "o",
                                          "ANTHROPIC_IDENTITY_TOKEN_FILE": "/x"})
    text = repr(k) + str(k)
    assert "secret-sarvam" not in text and "/x" not in text
    assert "sarvam=set" in text and "claude_wif=set" in text


def test_missing_names_what_is_absent() -> None:
    assert Keys().missing()[0] == "SARVAM_API_KEY"
    assert not Keys().claude_ready
    assert Keys(sarvam="x", wif={"ANTHROPIC_FEDERATION_RULE_ID": "r", "ANTHROPIC_ORGANIZATION_ID": "o",
                                 "ANTHROPIC_IDENTITY_TOKEN": "t"}).missing() == []
