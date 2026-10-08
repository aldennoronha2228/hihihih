import {expect,test} from '@playwright/test'
for(const board of ['arduino-nano','arduino-mega'])for(const type of ['potentiometer','servo','hc-sr04'])test(`${board} existing Velxio ${type} firmware behavior`,async({page,request})=>{
 test.setTimeout(180000)
 const project=await(await request.post('/api/hardware/projects',{data:{name:`${board} ${type}`,board}})).json()
 const command=async(name:string,args:Record<string,unknown>)=>{const r=await request.post(`/api/hardware/project/${project.id}/command`,{data:{name,args}});expect(r.ok(),await r.text()).toBe(true);return r.json()}
 const adc=board==='arduino-nano'?'A6':'A15'
 const source=type==='potentiometer'?`void setup(){Serial.begin(9600);}\nvoid loop(){Serial.println(analogRead(${adc}));delay(100);}`:type==='servo'?'void setup(){Serial.begin(9600);pinMode(9,OUTPUT);}\nvoid loop(){digitalWrite(9,HIGH);delayMicroseconds(1472);digitalWrite(9,LOW);delay(18);Serial.println("servo pulse");}':'void setup(){Serial.begin(9600);pinMode(7,OUTPUT);pinMode(6,INPUT);}\nvoid loop(){digitalWrite(7,HIGH);delayMicroseconds(10);digitalWrite(7,LOW);Serial.println(pulseIn(6,HIGH,30000)/58);delay(100);}'
 await command('add_component',{type,id:'part',properties:type==='potentiometer'?{value:512}:type==='hc-sr04'?{distance:75}:{},x:420,y:160})
 const endpoints=type==='potentiometer'?[[adc,'SIG'],['5V','VCC'],['GND','GND']]:type==='servo'?[['9','PWM'],['5V','V+'],['GND','GND']]:[['7','TRIG'],['6','ECHO'],['5V','VCC'],['GND','GND']]
 for(const [pin,target] of endpoints)await command('connect_wire',{from:{component:'board',pin},to:{component:'part',pin:target}})
 await command('generate_firmware',{source})
 await page.goto(`/project/${project.id}`)
 await expect(page.getByText('Runtime: Connected')).toBeVisible({timeout:30000})
 await page.getByRole('button',{name:'Compile',exact:true}).click()
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled({timeout:100000})
 await page.getByRole('button',{name:'Run',exact:true}).click()
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Serial monitor',exact:true}).click()
 await expect(page.getByLabel('Serial output',{exact:true})).toContainText(type==='potentiometer'?/\b51[0-9]\b/:type==='servo'?/servo pulse/:/\b7[3-7]\b/,{timeout:20000})
 if(type==='servo')await expect.poll(()=>page.locator('wokwi-servo').evaluate(element=>(element as HTMLElement &{angle:number}).angle)).toBeGreaterThan(85)
 await page.getByRole('button',{name:'Stop',exact:true}).click()
 await page.getByRole('button',{name:'Run',exact:true}).click()
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Stop',exact:true}).click()
})
