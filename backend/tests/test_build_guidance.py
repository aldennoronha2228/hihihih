from backend.agent import SYSTEM_PROMPT


def test_final_guidance_is_grounded_and_follows_real_operations():
    assert 'Build it yourself' in SYSTEM_PROMPT
    assert 'exact component IDs' in SYSTEM_PROMPT
    assert 'successful tool results' in SYSTEM_PROMPT
    assert 'disconnect power before wiring' in SYSTEM_PROMPT
    assert 'For analog-only projects' in SYSTEM_PROMPT
    assert 'If a build is incomplete' in SYSTEM_PROMPT
    assert 'after real operations' in SYSTEM_PROMPT
