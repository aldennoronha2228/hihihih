import {expect,test} from '@playwright/test'
for(const type of ['neopixel','led-ring','neopixel-matrix'])test(`Uno ${type} displays actual WS2812 firmware frames`,async({page,request})=>{
 test.setTimeout(180000)
 const project=await(await request.post('/api/hardware/projects',{data:{name:`Addressable ${type}`,board:'arduino-uno'}})).json()
 const command=async(name:string,args:Record<string,unknown>)=>{const r=await request.post(`/api/hardware/project/${project.id}/command`,{data:{name,args}});expect(r.ok(),await r.text()).toBe(true)}
 const count=type==='neopixel'?1:type==='led-ring'?16:64
 await command('add_component',{type,id:'pixels',x:450,y:150})
 for(const [pin,target] of [['6','DIN'],['5V',type==='neopixel'?'VDD':'VCC'],['GND',type==='neopixel'?'VSS':'GND']])await command('connect_wire',{from:{component:'board',pin},to:{component:'pixels',pin:target}})
 await command('generate_firmware',{source:`#include <Adafruit_NeoPixel.h>\nAdafruit_NeoPixel pixels(${count},6,NEO_GRB+NEO_KHZ800);\nvoid setup(){pixels.begin();Serial.begin(9600);pixels.fill(pixels.Color(64,128,192));pixels.show();}\nvoid loop(){static bool changed=false;if(Serial.available()){Serial.read();changed=true;}pixels.fill(changed?pixels.Color(192,64,128):pixels.Color(64,128,192));pixels.show();delay(100);}`})
 await command('compile_firmware',{})
 await page.goto(`/project/${project.id}`)
 await expect(page.getByText('Runtime: Connected',{exact:true})).toBeVisible({timeout:30000})
 await page.getByRole('button',{name:'Run',exact:true}).click()
 const element=page.locator(type==='neopixel'?'wokwi-neopixel':type==='led-ring'?'wokwi-led-ring':'wokwi-neopixel-matrix')
 const color=()=>element.evaluate((el,type)=>{const e=el as HTMLElement &{r:number;g:number;b:number;pixels?:unknown;getPixel?: (...args:number[])=>unknown};if(type==='neopixel')return [Math.round(e.r*255),Math.round(e.g*255),Math.round(e.b*255)];return {pixels:e.pixels,html:e.shadowRoot?.innerHTML.slice(-1000)}} ,type)
 if(type==='neopixel'){
  await expect.poll(color,{timeout:10000}).toEqual([64,128,192])
 }else if(type==='led-ring'){
  await expect.poll(()=>element.evaluate(el=>Array.from(el.shadowRoot?.querySelectorAll('[style]')??[]).map(n=>n.getAttribute('style')).join(' ')),{timeout:10000}).toMatch(/rgb\(64,\s*128,\s*192\)/i)
 }else{
  await expect.poll(()=>element.evaluate(el=>Number((el.shadowRoot?.querySelector('.pixel ellipse[fill="red"]') as SVGElement)?.style.opacity)),{timeout:10000}).toBeGreaterThan(0)
 }
 await page.getByRole('button',{name:'Serial monitor',exact:true}).click()
 await page.getByRole('textbox',{name:'Serial input',exact:true}).fill('change')
 await page.locator('.hw-serial-send').getByRole('button',{name:'Send',exact:true}).click()
 if(type==='neopixel')await expect.poll(color,{timeout:10000}).toEqual([192,64,128])
 if(type==='led-ring')await expect.poll(()=>element.evaluate(el=>Array.from(el.shadowRoot?.querySelectorAll('[style]')??[]).map(n=>n.getAttribute('style')).join(' ')),{timeout:10000}).toMatch(/rgb\(192,\s*64,\s*128\)/i)
 await page.getByRole('button',{name:'Stop',exact:true}).click()
 await page.getByRole('button',{name:'Run',exact:true}).click()
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Stop',exact:true}).click()
})
