import { expect, test } from '@playwright/test'

const cases = [
  {name:'potentiometer',type:'potentiometer',properties:{value:256},pins:[['5V','VCC'],['GND','GND'],['A0','SIG']],source:'void setup(){Serial.begin(9600);}\nvoid loop(){Serial.println(analogRead(A0));delay(100);}',expected:/\b25[0-9]\b/},
  {name:'servo',type:'servo',properties:{},pins:[['5V','V+'],['GND','GND'],['9','PWM']],source:'void setup(){pinMode(9,OUTPUT);Serial.begin(9600);}\nvoid loop(){digitalWrite(9,HIGH);delayMicroseconds(1472);digitalWrite(9,LOW);delay(18);Serial.println("servo pulse");}',expected:/servo pulse/},
  {name:'ultrasonic',type:'hc-sr04',properties:{distance:100},pins:[['5V','VCC'],['GND','GND'],['7','TRIG'],['6','ECHO']],source:'void setup(){pinMode(7,OUTPUT);pinMode(6,INPUT);Serial.begin(9600);}\nvoid loop(){digitalWrite(7,HIGH);delayMicroseconds(10);digitalWrite(7,LOW);unsigned long t=pulseIn(6,HIGH,30000);Serial.println(t/58);delay(100);}',expected:/\b(9[7-9]|10[0-3])\b/},
]
for(const scenario of cases)test(`existing Velxio Uno ${scenario.name} executes actual firmware`,async({page,request})=>{
 test.setTimeout(180000)
 const project=await(await request.post('/api/hardware/projects',{data:{name:`Uno ${scenario.name}`,board:'arduino-uno'}})).json()
 async function command(name:string,args:Record<string,unknown>){const r=await request.post(`/api/hardware/project/${project.id}/command`,{data:{name,args}});expect(r.ok(),await r.text()).toBe(true);return r.json()}
 await command('add_component',{type:scenario.type,id:'part',properties:scenario.properties,x:420,y:140})
 for(const [boardPin,pin] of scenario.pins)await command('connect_wire',{from:{component:'board',pin:boardPin},to:{component:'part',pin}})
 await command('generate_firmware',{source:scenario.source})
 await page.goto(`/project/${project.id}`)
 await expect(page.getByText('Runtime: Connected')).toBeVisible({timeout:30000})
 await page.getByRole('button',{name:'Compile',exact:true}).click()
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled({timeout:90000})
 await page.getByRole('button',{name:'Run',exact:true}).click()
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Serial monitor',exact:true}).click()
 await expect(page.locator('.hw-dock')).toContainText(scenario.expected,{timeout:20000})
 if(scenario.type==='servo')await expect.poll(()=>page.locator('wokwi-servo').evaluate(element=>(element as HTMLElement & {angle:number}).angle),{timeout:10000}).toBeGreaterThan(85)
 if(scenario.type==='potentiometer'){
  await page.locator('wokwi-potentiometer').evaluate(element=>{(element as HTMLElement & {value:number}).value=768;element.dispatchEvent(new Event('input',{bubbles:true}))})
  await expect(page.locator('.hw-dock')).toContainText(/\b76[0-9]\b/,{timeout:10000})
 }
 await page.getByRole('button',{name:'Stop',exact:true}).click()
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Run',exact:true}).click()
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Stop',exact:true}).click()
 await page.reload()
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled({timeout:30000})
})

test('unwired servo is not animated by unrelated PWM',async({page,request})=>{
 const project=await(await request.post('/api/hardware/projects',{data:{name:'Unwired servo',board:'arduino-uno'}})).json()
 await request.post(`/api/hardware/project/${project.id}/command`,{data:{name:'add_component',args:{type:'servo',id:'servo'}}})
 await page.goto(`/project/${project.id}`)
 await page.getByRole('button',{name:'Compile',exact:true}).click()
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled({timeout:90000})
 const before=await page.locator('wokwi-servo').evaluate(element=>(element as HTMLElement & {angle:number}).angle)
 await page.getByRole('button',{name:'Run',exact:true}).click();await page.waitForTimeout(500)
 expect(await page.locator('wokwi-servo').evaluate(element=>(element as HTMLElement & {angle:number}).angle)).toBe(before)
 await page.getByRole('button',{name:'Stop',exact:true}).click()
})
