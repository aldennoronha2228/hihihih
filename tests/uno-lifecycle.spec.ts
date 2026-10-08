import { expect, test } from '@playwright/test'

test('upstream peripheral leases stop on topology edits and project changes', async ({page,request})=>{
 test.setTimeout(150000)
 const project=await(await request.post('/api/hardware/projects',{data:{name:'Peripheral lifecycle',board:'arduino-uno'}})).json()
 const command=async(name:string,args:Record<string,unknown>)=>{const response=await request.post(`/api/hardware/project/${project.id}/command`,{data:{name,args}});expect(response.ok(),await response.text()).toBe(true);return response.json()}
 await command('add_component',{type:'servo',id:'servo',x:420,y:150})
 for(const [pin,target] of [['5V','V+'],['GND','GND'],['9','PWM']])await command('connect_wire',{from:{component:'board',pin},to:{component:'servo',pin:target}})
 await command('generate_firmware',{source:'void setup(){pinMode(9,OUTPUT);}\nvoid loop(){digitalWrite(9,HIGH);delayMicroseconds(1472);digitalWrite(9,LOW);delay(18);}'})
 await page.goto(`/project/${project.id}`)
 await page.getByRole('button',{name:'Compile',exact:true}).click()
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled({timeout:90000})
 await page.getByRole('button',{name:'Run',exact:true}).click()
 await expect.poll(()=>page.locator('wokwi-servo').evaluate(element=>(element as HTMLElement & {angle:number}).angle)).toBeGreaterThan(85)
 const next=await command('remove_wire',{id:(await(await request.get(`/api/hardware/projects/${project.id}`)).json()).wires.find((wire:{to:{pin:string}})=>wire.to.pin==='PWM').id})
 await page.evaluate(value=>window.dispatchEvent(new CustomEvent('wireup:project-changed',{detail:{project:value}})),next)
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeVisible()
 const other=await(await request.post('/api/hardware/projects',{data:{name:'Next project',board:'arduino-uno'}})).json()
 await page.goto(`/project/${other.id}`)
 await expect(page.locator('wokwi-servo')).toHaveCount(0)
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeDisabled()
})
