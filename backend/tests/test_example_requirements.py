import pytest
from backend.example_requirements import search_example_requirements


def test_all_examples_are_available_as_requirement_references():
    result = search_example_requirements('OLED I2C', 3)
    assert result['total_examples'] == 321
    assert result['examples']
    assert any(example.get('dependencies') for example in result['examples'])
    assert 'not evidence' in result['verification']


def test_requirement_query_is_bounded():
    with pytest.raises(ValueError):
        search_example_requirements('', 3)
    with pytest.raises(ValueError):
        search_example_requirements('led', 50)
