"""Controls matching the reused upstream sensor models; no invented physical measurement."""
CONTROLS = {
    'gas-sensor': ('gasLevel', 100),
    'flame-sensor': ('intensity', 0),
    'big-sound-sensor': ('soundLevel', 512),
    'small-sound-sensor': ('soundLevel', 512),
}


def add_sensor_controls(entry):
    control = CONTROLS.get(entry['id'])
    if not control:
        return
    name, default = control
    entry.setdefault('defaultValues', {})[name] = default
    if not any(prop['name'] == name for prop in entry.setdefault('properties', [])):
        entry['properties'].append({'name': name, 'type': 'number', 'min': 0, 'max': 1023, 'defaultValue': default, 'control': 'range'})
