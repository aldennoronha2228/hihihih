import {expect,test} from '@playwright/test'
test('Uno joystick axes and press reach actual firmware',async({page,request})=>{
 test.setTimeout(150000)
 const project=await(await request.post('/api/hardware/projects',{data:{name:'Joystick',board:'arduino-uno'}})).json()
 const command=async(name:string,args:Record<string,unknown>)=>{const response=await request.post(`/api/hardware/project/${project.id}/command`,{data:{name,args}});expect(response.ok(),await response.text()).toBe(true)}
 await command('add_component',{type:'analog-joystick',id:'stick',x:430,y:160})
 for(const [pin,target] of [['5V','VCC'],['GND','GND'],['A0','VERT'],['A1','HORZ'],['2','SEL']])await command('connect_wire',{from:{component:'board',pin},to:{component:'stick',pin:target}})
 await command('generate_firmware',{source:'void setup(){Serial.begin(9600);pinMode(2,INPUT_PULLUP);}\nvoid loop(){Serial.print(analogRead(A0));Serial.print(",");Serial.print(analogRead(A1));Serial.print(",");Serial.println(digitalRead(2));delay(100);}'})
 await command('compile_firmware',{})
 await page.goto(`/project/${project.id}`)
 await page.getByRole('button',{name:'Run',exact:true}).click()
 await page.getByRole('button',{name:'Serial monitor',exact:true}).click()
 await expect(page.getByLabel('Serial output',{exact:true})).toContainText(/51[0-9],51[0-9],1/,{timeout:15000})
 await page.locator('wokwi-analog-joystick').evaluate(element=>{Object.assign(element,{xValue:1,yValue:-1});element.dispatchEvent(new CustomEvent('joystick-move',{detail:{x:1,y:-1}}));element.dispatchEvent(new Event('input'))})
 await expect(page.getByLabel('Serial output',{exact:true})).toContainText(/1023,0,1/,{timeout:10000})
 await page.locator('wokwi-analog-joystick').evaluate(element=>element.dispatchEvent(new CustomEvent('button-press',{detail:{pressed:true}})))
 await expect(page.getByLabel('Serial output',{exact:true})).toContainText(/1023,0,0/,{timeout:10000})
 await page.getByRole('button',{name:'Stop',exact:true}).click()
})
