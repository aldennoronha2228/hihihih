import {expect,test} from '@playwright/test'
for(const board of ['arduino-uno','arduino-nano','arduino-mega'])test(`${board} RGB channels follow genuine PWM`,async({page,request})=>{
 test.setTimeout(180000)
 const project=await(await request.post('/api/hardware/projects',{data:{name:'RGB PWM',board}})).json()
 const command=async(name:string,args:Record<string,unknown>)=>{const r=await request.post(`/api/hardware/project/${project.id}/command`,{data:{name,args}});expect(r.ok(),await r.text()).toBe(true)}
 await command('add_component',{type:'rgb-led',id:'rgb',x:470,y:150})
 for(const [index,pin] of ['R','G','B'].entries()){
  await command('add_component',{type:'resistor',id:`r${index}`,properties:{value:'220'},x:370,y:130+index*50})
  await command('connect_wire',{from:{component:'board',pin:String([9,10,11][index])},to:{component:`r${index}`,pin:'1'}})
  await command('connect_wire',{from:{component:`r${index}`,pin:'2'},to:{component:'rgb',pin}})
 }
 await command('connect_wire',{from:{component:'rgb',pin:'COM'},to:{component:'board',pin:'GND'}})
 await command('generate_firmware',{source:'void setup(){pinMode(9,OUTPUT);pinMode(10,OUTPUT);pinMode(11,OUTPUT);analogWrite(9,64);analogWrite(10,128);analogWrite(11,192);}\nvoid loop(){}'})
 await page.goto(`/project/${project.id}`)
 await page.getByRole('button',{name:'Compile',exact:true}).click()
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled({timeout:100000})
 await page.getByRole('button',{name:'Run',exact:true}).click()
 await page.waitForTimeout(1000)
 console.log('RGB_DIAGNOSTIC',board,await page.locator('wokwi-rgb-led').evaluate(element=>({r:(element as HTMLElement &{ledRed:number}).ledRed,g:(element as HTMLElement &{ledGreen:number}).ledGreen,b:(element as HTMLElement &{ledBlue:number}).ledBlue})),await page.getByRole('button',{name:'Stop',exact:true}).count(),await page.getByRole('alert').allTextContents())
 await expect.poll(()=>page.locator('wokwi-rgb-led').evaluate(element=>{const e=element as HTMLElement &{ledRed:number;ledGreen:number;ledBlue:number};return e.ledRed>45&&e.ledRed<85&&e.ledGreen>110&&e.ledGreen<150&&e.ledBlue>170&&e.ledBlue<215}),{timeout:15000}).toBe(true)
 await page.getByRole('button',{name:'Stop',exact:true}).click()
 await page.getByRole('button',{name:'Run',exact:true}).click()
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Stop',exact:true}).click()
})
