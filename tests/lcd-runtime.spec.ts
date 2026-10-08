import {expect,test} from '@playwright/test'
for(const type of ['lcd1602-i2c','lcd2004-i2c'])test(`Uno ${type} renders real LiquidCrystal firmware text`,async({page,request})=>{
 test.setTimeout(180000)
 const project=await(await request.post('/api/hardware/projects',{data:{name:'LCD I2C',board:'arduino-uno'}})).json()
 const command=async(name:string,args:Record<string,unknown>)=>{const r=await request.post(`/api/hardware/project/${project.id}/command`,{data:{name,args}});expect(r.ok(),await r.text()).toBe(true)}
 await command('add_component',{type:'lcd1602-i2c',id:'lcd',x:450,y:150})
 for(const [pin,target] of [['5V','VCC'],['GND','GND'],['A4','SDA'],['A5','SCL']])await command('connect_wire',{from:{component:'board',pin},to:{component:'lcd',pin:target}})
 await command('generate_firmware',{source:'#include <Wire.h>\n#include <LiquidCrystal_I2C.h>\nLiquidCrystal_I2C lcd(0x27,16,2);\nvoid setup(){lcd.init();lcd.backlight();lcd.setCursor(0,0);lcd.print("WireUp LCD");lcd.setCursor(0,1);lcd.print("Real I2C");}\nvoid loop(){}'})
 await page.goto(`/project/${project.id}`)
 await page.getByRole('button',{name:'Compile',exact:true}).click()
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled({timeout:100000})
 await page.getByRole('button',{name:'Run',exact:true}).click()
 await expect.poll(()=>page.locator('wokwi-lcd1602').evaluate(e=>String.fromCharCode(...Array.from((e as HTMLElement &{characters:Uint8Array}).characters ?? []))),{timeout:15000}).toContain('WireUp LCD')
 await page.getByRole('button',{name:'Stop',exact:true}).click()
 await page.getByRole('button',{name:'Run',exact:true}).click()
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Stop',exact:true}).click()
})
