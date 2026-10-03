import json
from pathlib import Path

ANALYSIS_PATH = Path(__file__).resolve().parent / 'templates/example-analysis.json'


def search_example_requirements(query: str, limit: int = 5):
    if not isinstance(query, str) or not 1 <= len(query.strip()) <= 200:
        raise ValueError('Search query must contain 1 to 200 characters.')
    if type(limit) is not int or not 1 <= limit <= 8:
        raise ValueError('Search limit must be between 1 and 8.')
    data = json.loads(ANALYSIS_PATH.read_text(encoding='utf-8'))
    words = query.lower().split()
    matches = []
    for example in data['examples']:
        identity = ' '.join([example['id'], example['title'], *example.get('boards', []), *[part['type'] for part in example.get('components', [])]]).lower()
        score = sum(1 for word in words if word in identity)
        if score:
            matches.append((score, example))
    matches.sort(key=lambda item: (-item[0], item[1]['id']))
    return {
        'source': data['source'], 'total_examples': data['total'],
        'verification': 'Static source and canonical-service analysis; not evidence that these examples compile or simulate.',
        'examples': [{key: value for key, value in example.items() if key in (
            'id', 'title', 'boards', 'components', 'language', 'dependencies', 'blockers', 'classification', 'canonical_validation', 'payload_features', 'requirements',
        )} for _, example in matches[:limit]],
    }
