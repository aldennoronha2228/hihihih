import { expect, test } from '@playwright/test'

test('Uno ILI9341 renders library fillRect in all rotations and shares SPI with OLED after restart', async ({ page, request }) => {
  test.setTimeout(180000)
  const response = await request.post('/api/hardware/projects', { data: { name: 'ILI9341 SPI rotations', board: 'arduino-uno' } })
  expect(response.ok(), await response.text()).toBe(true)
  const project = await response.json()
  const command = async (name: string, args: Record<string, unknown>) => {
    const result = await request.post(`/api/hardware/project/${project.id}/command`, { data: { name, args } })
    expect(result.ok(), await result.text()).toBe(true)
    return result.json()
  }
  await command('add_component', { type: 'ili9341', id: 'tft', x: 460, y: 100 })
  for (const [pin, target] of [['3V3', 'VCC'], ['GND', 'GND'], ['11', 'MOSI'], ['13', 'SCK'], ['10', 'CS'], ['9', 'D/C'], ['8', 'RST'], ['3V3', 'LED']]) {
    await command('connect_wire', { from: { component: 'board', pin }, to: { component: 'tft', pin: target } })
  }
  await command('add_component', { type: 'ssd1306', id: 'oled', properties: { protocol: 'spi' }, x: 680, y: 100 })
  for (const [pin, target] of [['5V', 'VIN'], ['GND', 'GND'], ['11', 'DATA'], ['13', 'CLK'], ['4', 'CS'], ['3', 'DC'], ['2', 'RST']]) {
    await command('connect_wire', { from: { component: 'board', pin }, to: { component: 'oled', pin: target } })
  }
  await command('generate_firmware', { source: `#include <SPI.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ILI9341.h>
Adafruit_ILI9341 tft(10, 9, 8);
void setup() {
  pinMode(4, OUTPUT);
  digitalWrite(4, HIGH);
  tft.begin();
  tft.fillScreen(ILI9341_BLACK);
  tft.setRotation(0);
  tft.fillRect(10, 20, 12, 8, ILI9341_RED);
  tft.setRotation(1);
  tft.fillRect(270, 30, 12, 8, ILI9341_GREEN);
  tft.setRotation(2);
  tft.fillRect(40, 60, 12, 8, ILI9341_BLUE);
  tft.setRotation(3);
  tft.fillRect(280, 50, 12, 8, ILI9341_YELLOW);
  pinMode(3, OUTPUT);
  pinMode(2, OUTPUT);
  digitalWrite(2, LOW);
  delay(10);
  digitalWrite(2, HIGH);
  SPI.beginTransaction(SPISettings(1000000, MSBFIRST, SPI_MODE0));
  digitalWrite(4, LOW);
  digitalWrite(3, LOW);
  byte commands[] = {0xAF, 0x20, 0, 0x21, 0, 127, 0x22, 0, 7};
  for (byte c : commands) SPI.transfer(c);
  digitalWrite(3, HIGH);
  for (int i = 0; i < 1024; i++) SPI.transfer(0xFF);
  digitalWrite(4, HIGH);
  SPI.endTransaction();
}
void loop() {}
` })
  await page.goto(`/project/${project.id}`)
  await page.getByRole('button', { name: 'Compile', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Run', exact: true })).toBeEnabled({ timeout: 100000 })
  const pixels = () => page.locator('wokwi-ili9341').evaluate(element => {
    const canvas = (element as HTMLElement & { canvas?: HTMLCanvasElement }).canvas
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return null
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data
    // The original model expands RGB565 channels by shifting, not bit replication.
    const colors = [[248, 0, 0], [0, 252, 0], [0, 0, 248], [248, 252, 0]]
    const counts = colors.map(color => {
      let count = 0
      for (let i = 0; i < data.length; i += 4) {
        if (color.every((value, channel) => data[i + channel] === value)) count++
      }
      return count
    })
    const points = [[10, 20], [30, 49], [199, 259], [189, 280]].map(([x, y]) => {
      const offset = (y * canvas.width + x) * 4
      return Array.from(data.slice(offset, offset + 3))
    })
    return { width: canvas.width, height: canvas.height, counts, points }
  })
  const expected = { width: 240, height: 320, counts: [96, 96, 96, 96], points: [[248, 0, 0], [0, 252, 0], [0, 0, 248], [248, 252, 0]] }
  const oledLit = () => page.locator('wokwi-ssd1306').evaluate(element => {
    const image = (element as HTMLElement & { imageData?: ImageData }).imageData
    return !!image && Array.from(image.data).some((value, index) => index % 4 !== 3 && value > 0)
  })
  for (let run = 0; run < 2; run++) {
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await expect.poll(oledLit, { timeout: 20000 }).toBe(true)
    await expect.poll(pixels, { timeout: 20000 }).toEqual(expected)
    await page.getByRole('button', { name: 'Stop', exact: true }).click()
  }
})
