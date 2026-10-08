import {expect,test} from '@playwright/test'
for(const type of ['ntc-temperature-sensor','photoresistor-sensor','pir-motion-sensor'])test(`Uno ${type} uses real firmware inputs`,async({page,request})=>{
 test.setTimeout(180000)
 const project=await(await request.post('/api/hardware/projects',{data:{name:type,board:'arduino-uno'}})).json()
 const command=async(name:string,args:Record<string,unknown>)=>{const r=await request.post(`/api/hardware/project/${project.id}/command`,{data:{name,args}});expect(r.ok(),await r.text()).toBe(true);return r.json()}
 const pir=type==='pir-motion-sensor';const output=type==='photoresistor-sensor'?'AO':'OUT'
 await command('add_component',{type,id:'sensor',x:430,y:150})
 for(const [pin,target] of [['5V','VCC'],['GND','GND'],[pir?'2':'A0',output]])await command('connect_wire',{from:{component:'board',pin},to:{component:'sensor',pin:target}})
 await command('generate_firmware',{source:pir?'void setup(){Serial.begin(9600);pinMode(2,INPUT);}\nvoid loop(){Serial.println(digitalRead(2));delay(100);}':'void setup(){Serial.begin(9600);}\nvoid loop(){Serial.println(analogRead(A0));delay(100);}'})
 await page.goto(`/project/${project.id}`)
 await page.getByRole('button',{name:'Compile',exact:true}).click()
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled({timeout:100000})
 await page.getByRole('button',{name:'Run',exact:true}).click()
 await page.getByRole('button',{name:'Serial monitor',exact:true}).click()
 await expect(page.getByLabel('Serial output',{exact:true})).toContainText(pir?'0':/\b51[0-9]\b/,{timeout:15000})
 if(pir){await page.locator('wokwi-pir-motion-sensor').evaluate(element=>element.dispatchEvent(new Event('click')));await expect(page.getByLabel('Serial output',{exact:true})).toContainText('1',{timeout:10000})}
 else{
  await page.getByRole('button',{name:'Stop',exact:true}).click()
  const updated=await command('modify_component',{id:'sensor',properties:type==='photoresistor-sensor'?{lux:750}:{temperature:50}})
  await page.evaluate(project=>window.dispatchEvent(new CustomEvent('wireup:project-changed',{detail:{project}})),updated)
  await page.getByRole('button',{name:'Run',exact:true}).click()
  await page.getByRole('button',{name:'Serial monitor',exact:true}).click()
  await expect(page.getByLabel('Serial output',{exact:true})).toContainText(type==='photoresistor-sensor'?/\b76[0-9]\b/:/\b27[0-5]\b/,{timeout:15000})
 }
 await page.getByRole('button',{name:'Stop',exact:true}).click()
})
