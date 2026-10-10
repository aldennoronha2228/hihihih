from backend.agent import _build_intent


def test_no_simulation_does_not_cancel_a_real_build():
    assert _build_intent('Build an Arduino LED circuit. Do not run simulation yet.')
    assert _build_intent('Create firmware. Do not replace the board.')


def test_purely_negated_actions_do_not_start_a_build():
    assert not _build_intent('Do not build anything.')
    assert not _build_intent('Do not run simulation.')
    assert not _build_intent('Explain how to build a circuit.')
