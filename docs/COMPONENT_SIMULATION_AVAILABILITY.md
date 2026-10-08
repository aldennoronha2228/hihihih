# Current component simulation availability

Source: actual backend catalog and browser runtime handlers. This lists current WireUp support, not all upstream Velxio capabilities.

**Updated Uno integration:** potentiometer, servo, and HC-SR04 below now have verified scoped behavior on Arduino Uno through the original Velxio models. Their entries in the historical unsupported inventory do not apply to that Uno combination. Other boards and peripheral combinations remain unverified. See [runtime integration](VELXIO_RUNTIME_INTEGRATION.md). DHT22 and common-cathode RGB now also have verified behavior on Uno/Nano/Mega; the original historical inventory below excludes these newly integrated combinations. See the runtime integration document for current scope.

## No implemented normal browser board/peripheral simulation

### Boards without normal browser simulation

| Component | ID |
|---|---|
| ESP32 DevKit V1 | `esp32-devkit-v1` |
| ESP32 DevKit C V4 | `esp32-devkit-c-v4` |
| ESP32-S3 DevKitC-1 | `esp32-s3` |
| ESP32-C3 DevKitM-1 | `esp32-c3` |
| Raspberry Pi 3 | `raspberry-pi-3` |
| Raspberry Pi 4 | `raspberry-pi-4` |
| Raspberry Pi 5 | `raspberry-pi-5` |

### analog

| Component | ID |
|---|---|
| 1N4007 (1 kV Rectifier) | `diode-1n4007` |
| 1N4148 (Small-Signal Diode) | `diode-1n4148` |
| 1N4733 (5.1 V Zener) | `zener-1n4733` |
| 1N5817 (Schottky 20V) | `diode-1n5817` |
| 1N5819 (Schottky 40V) | `diode-1n5819` |
| 2N2222 (NPN BJT) | `bjt-2n2222` |
| 2N3055 (NPN Power BJT) | `bjt-2n3055` |
| 2N3906 (PNP BJT) | `bjt-2n3906` |
| 2N7000 (N-MOSFET) | `mosfet-2n7000` |
| 4N25 (Optocoupler) | `opto-4n25` |
| 7805 (+5V Linear Regulator) | `reg-7805` |
| 7812 (+12V Linear Regulator) | `reg-7812` |
| 7905 (−5V Linear Regulator) | `reg-7905` |
| 9V Battery | `battery-9v` |
| AA Battery (1.5V) | `battery-aa` |
| BC547 (NPN BJT) | `bjt-bc547` |
| BC557 (PNP BJT) | `bjt-bc557` |
| Coin Cell (CR2032, 3V) | `battery-coin-cell` |
| Diode (generic) | `diode` |
| FQP27P06 (P-MOSFET) | `mosfet-fqp27p06` |
| Ideal Op-Amp | `opamp-ideal` |
| IRF540 (N-MOSFET Power) | `mosfet-irf540` |
| IRF9540 (P-MOSFET) | `mosfet-irf9540` |
| LM317 (Adjustable Linear Regulator) | `reg-lm317` |
| LM324 (Quad Op-Amp) | `opamp-lm324` |
| LM358 (Dual Op-Amp) | `opamp-lm358` |
| LM741 (Op-Amp) | `opamp-lm741` |
| PC817 (Optocoupler) | `opto-pc817` |
| Regulated Power Supply | `power-supply` |
| Signal Generator | `signal-generator` |
| TL072 (JFET Op-Amp) | `opamp-tl072` |

### displays

| Component | ID |
|---|---|
| ePaper 1.54" (200×200, B/W) | `epaper-1in54-bw` |
| ePaper 2.13" (250×122, B/W) | `epaper-2in13-bw` |
| ePaper 2.13" (250×122, B/W/Red) | `epaper-2in13-bwr` |
| ePaper 2.9" (296×128, B/W) | `epaper-2in9-bw` |
| ePaper 2.9" (296×128, B/W/Red) | `epaper-2in9-bwr` |
| ePaper 4.2" (400×300, B/W) | `epaper-4in2-bw` |
| ePaper 5.65" (600×448, ACeP 7-colour) | `epaper-5in65-7c` |
| ePaper 7.5" (800×480, B/W) | `epaper-7in5-bw` |
| ILI9341 | `ili9341` |
| LCD 16x2 (I2C) | `lcd1602-i2c` |
| LCD 20x4 (I2C) | `lcd2004-i2c` |
| LCD1602 | `lcd1602` |
| LCD2004 | `lcd2004` |
| SSD1306 OLED | `ssd1306` |
| SSD1306 OLED (I2C, 4-pin) | `ssd1306-i2c-4pin` |

### electromech

| Component | ID |
|---|---|
| L293D (Dual H-Bridge Motor Driver) | `motor-driver-l293d` |
| Relay (SPDT) | `relay` |

### input

| Component | ID |
|---|---|
| DIP Switch 8 | `dip-switch-8` |
| KY-040 Rotary Encoder | `ky-040` |
| Membrane Keypad | `membrane-keypad` |
| Potentiometer | `potentiometer` |
| Slide Switch | `slide-switch` |

### logic

| Component | ID |
|---|---|
| 74HC00 (Quad 2-input NAND) | `ic-74hc00` |
| 74HC02 (Quad 2-input NOR) | `ic-74hc02` |
| 74HC04 (Hex Inverter) | `ic-74hc04` |
| 74HC08 (Quad 2-input AND) | `ic-74hc08` |
| 74HC14 (Hex Schmitt Inverter) | `ic-74hc14` |
| 74HC32 (Quad 2-input OR) | `ic-74hc32` |
| 74HC86 (Quad 2-input XOR) | `ic-74hc86` |
| AND Gate | `logic-gate-and` |
| AND Gate (3-input) | `logic-gate-and-3` |
| AND Gate (4-input) | `logic-gate-and-4` |
| D Flip-Flop | `flip-flop-d` |
| JK Flip-Flop | `flip-flop-jk` |
| NAND Gate | `logic-gate-nand` |
| NAND Gate (3-input) | `logic-gate-nand-3` |
| NAND Gate (4-input) | `logic-gate-nand-4` |
| NOR Gate | `logic-gate-nor` |
| NOR Gate (3-input) | `logic-gate-nor-3` |
| NOR Gate (4-input) | `logic-gate-nor-4` |
| NOT Gate (Inverter) | `logic-gate-not` |
| OR Gate | `logic-gate-or` |
| OR Gate (3-input) | `logic-gate-or-3` |
| OR Gate (4-input) | `logic-gate-or-4` |
| T Flip-Flop | `flip-flop-t` |
| XNOR Gate | `logic-gate-xnor` |
| XOR Gate | `logic-gate-xor` |

### motors

| Component | ID |
|---|---|
| A4988 Stepper Driver | `a4988` |
| Biaxial Stepper | `biaxial-stepper` |
| Servo | `servo` |
| Stepper Motor | `stepper-motor` |

### other

| Component | ID |
|---|---|
| 7 Segment | `7segment` |
| Analog Joystick | `analog-joystick` |
| Big Sound Sensor | `big-sound-sensor` |
| DS1307 | `ds1307` |
| DS3231 RTC | `ds3231` |
| Flame Sensor | `flame-sensor` |
| Gas Sensor | `gas-sensor` |
| HX711 | `hx711` |
| KS2E-M-DC5 | `ks2e-m-dc5` |
| LED Ring | `led-ring` |
| microSD Card | `microsd-card` |
| Nano RP2040 Connect | `nano-rp2040-connect` |
| NeoPixel Matrix | `neopixel-matrix` |
| Rotary Dialer | `rotary-dialer` |
| Slide Potentiometer | `slide-potentiometer` |
| Small Sound Sensor | `small-sound-sensor` |
| Tilt Switch | `tilt-switch` |

### output

| Component | ID |
|---|---|
| Buzzer | `buzzer` |
| Led Bar Graph | `led-bar-graph` |
| Neopixel | `neopixel` |
| RGB Led | `rgb-led` |

### passive

| Component | ID |
|---|---|
| Breadboard (full) | `breadboard` |
| Breadboard Mini | `breadboard-mini` |
| Cap. 1 nF | `cap-1n` |
| Cap. 1 µF | `cap-1u` |
| Cap. 10 nF | `cap-10n` |
| Cap. 10 pF | `cap-10p` |
| Cap. 100 nF | `cap-100n` |
| Cap. 100 pF | `cap-100p` |
| Cap. 22 pF | `cap-22p` |
| Electrolytic 1 µF | `cap-elec-1u` |
| Electrolytic 10 µF | `cap-elec-10u` |
| Electrolytic 100 µF | `cap-elec-100u` |
| Electrolytic 1000 µF | `cap-elec-1000u` |
| Electrolytic 47 µF | `cap-elec-47u` |
| Electrolytic 470 µF | `cap-elec-470u` |
| Electrolytic Cap. (custom) | `capacitor-electrolytic` |
| Franzininho | `franzininho` |
| Inductor 1 mH | `ind-1m` |
| Inductor 10 mH | `ind-10m` |
| Inductor 100 µH | `ind-100u` |
| IR Receiver | `ir-receiver` |
| IR Remote | `ir-remote` |
| Junction | `junction` |
| Resistor 1 kΩ | `resistor-1k` |
| Resistor 1 MΩ | `resistor-1m` |
| Resistor 10 kΩ | `resistor-10k` |
| Resistor 100 kΩ | `resistor-100k` |
| Resistor 2.2 kΩ | `resistor-2k2` |
| Resistor 22 kΩ | `resistor-22k` |
| Resistor 220 Ω | `resistor-220` |
| Resistor 330 Ω | `resistor-330` |
| Resistor 4.7 kΩ | `resistor-4k7` |
| Resistor 47 kΩ | `resistor-47k` |
| Resistor 470 Ω | `resistor-470` |

### sensor

| Component | ID |
|---|---|
| BMP280 (Pressure + Temp) | `bmp280` |

### sensors

| Component | ID |
|---|---|
| DHT22 | `dht22` |
| GPS NEO-6M | `gps-neo6m` |
| HC-SR04 | `hc-sr04` |
| Heart Beat Sensor | `heart-beat-sensor` |
| MPU6050 | `mpu6050` |
| NTC Temperature Sensor | `ntc-temperature-sensor` |
| Photodiode | `photodiode` |
| Photoresistor Sensor | `photoresistor-sensor` |
| PIR Motion Sensor | `pir-motion-sensor` |

## Separate SPICE-model components
These have electrical models in the analog solver, but not full MCU peripheral emulation. Model coverage varies; this does not establish hardware safety.

| Component | ID |
|---|---|
| Cap. ceramic (custom) | `capacitor` |
| Inductor (custom) | `inductor` |
| Resistor (custom) | `resistor` |
| DC Voltage Source | `source-dc-voltage` |
| DC Current Source | `source-dc-current` |
| Sine Voltage Source | `source-sine-voltage` |
| Pulse Voltage Source | `source-pulse-voltage` |
| Piecewise Linear Voltage Source | `source-pwl-voltage` |
| AC Voltage Source | `source-ac-voltage` |
| SPICE Ground | `ground` |
