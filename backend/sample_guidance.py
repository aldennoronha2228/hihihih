def setup_guidance(template):
    lines = [f'## Welcome to {template["title"]}', template['description'],
             f'\n**Board:** {template["board"]}. Your editable copy already includes its components, connections, and firmware.',
             '\n### What is connected']
    if template['wires']:
        lines.extend(f'- `{wire["from"]["component"]}:{wire["from"]["pin"]}` → `{wire["to"]["component"]}:{wire["to"]["pin"]}`' for wire in template['wires'])
    else:
        lines.append('This example uses the onboard LED or serial output; no external wiring is required.')
    lines += ['\n### Get started',
              '1. Open **Sketch** to inspect the preloaded firmware.',
              '2. Click **Compile** and check the compiler console. Compilation alone does not run the circuit.',
              '3. When the browser runtime is connected and Run is enabled, click **Run**.',
              '4. Observe the LED or open the serial monitor. For button examples, press/release the button.',
              '5. Click **Stop** before changing the circuit. Save and recompile after firmware changes.',
              '\n### Build it physically',
              'Disconnect power before wiring. Match the listed pins and check polarity; retain the LED series resistor. Upload the sketch using the correct board configuration, then test with power applied.',
              '\nIf Run is unavailable, read the displayed runtime/firmware diagnostic. This welcome guide is generated from the sample template, not a live model response or proof of a successful simulation.']
    if template.get('adaptations'):
        lines.append('\n**Template notes:** ' + ' '.join(template['adaptations']))
    return '\n\n'.join(lines)
