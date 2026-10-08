import {expect,test} from '@playwright/test'
test('upstream slide potentiometer injects actual Uno ADC values',async({page,request})=>{
 test.setTimeout(150000)
 const project=await(await request.post('/api/hardware/projects',{data:{name:'Slide ADC',board:'arduino-uno'}})).json()
 const command=async(name:string,args:Record<string,unknown>)=>{const r=await request.post(`/api/hardware/project/${project.id}/command`,{data:{name,args}});expect(r.ok(),await r.text()).toBe(true)}
 await command('add_component',{type:'slide-potentiometer',id:'slide',properties:{value:50},x:420,y:120})
 for(const [pin,to] of [['5V','VCC'],['GND','GND'],['A0','SIG']])await command('connect_wire',{from:{component:'board',pin},to:{component:'slide',pin:to}})
 await command('generate_firmware',{source:'void setup(){Serial.begin(9600);}\nvoid loop(){Serial.println(analogRead(A0));delay(100);}'})
 await page.goto(`/project/${project.id}`)
 await page.getByRole('button',{name:'Compile',exact:true}).click()
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled({timeout:90000})
 await page.getByRole('button',{name:'Run',exact:true}).click()
 await page.getByRole('button',{name:'Serial monitor',exact:true}).click()
 await expect(page.getByLabel('Serial output',{exact:true})).toContainText(/\b51[0-9]\b/,{timeout:15000})
 await page.locator('wokwi-slide-potentiometer').evaluate(element=>{(element as HTMLElement &{value:number}).value=75;element.dispatchEvent(new Event('input'))})
 await expect(page.getByLabel('Serial output',{exact:true})).toContainText(/\b76[0-9]\b/,{timeout:15000})
 await page.getByRole('button',{name:'Stop',exact:true}).click()
})
