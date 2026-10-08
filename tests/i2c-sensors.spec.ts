import {expect,test} from '@playwright/test'
for(const type of ['mpu6050','ds1307','ds3231'])test(`Uno ${type} responds through original I2C model`,async({page,request})=>{
 test.setTimeout(180000)
 const project=await(await request.post('/api/hardware/projects',{data:{name:`I2C ${type}`,board:'arduino-uno'}})).json()
 const command=async(name:string,args:Record<string,unknown>)=>{const r=await request.post(`/api/hardware/project/${project.id}/command`,{data:{name,args}});expect(r.ok(),await r.text()).toBe(true)}
 await command('add_component',{type,id:'sensor',x:450,y:150})
 for(const [pin,to] of [['5V',type==='ds1307'?'5V':'VCC'],['GND','GND'],['A4','SDA'],['A5','SCL']])await command('connect_wire',{from:{component:'board',pin},to:{component:'sensor',pin:to}})
 const source=type==='mpu6050'?'#include <Wire.h>\nvoid setup(){Serial.begin(9600);Wire.begin();Wire.beginTransmission(0x68);Wire.write(0x6B);Wire.write(0);Serial.println(Wire.endTransmission());Wire.beginTransmission(0x68);Wire.write(0x75);Wire.endTransmission(false);Wire.requestFrom(0x68,1);if(Wire.available())Serial.println(Wire.read());}\nvoid loop(){}':`#include <Wire.h>\nvoid setup(){Serial.begin(9600);Wire.begin();Wire.beginTransmission(0x68);Wire.write(0);Wire.write(0x12);Wire.write(0x34);Wire.write(0x10);Wire.write(1);Wire.write(8);Wire.write(10);Wire.write(0x26);Serial.println(Wire.endTransmission());Wire.beginTransmission(0x68);Wire.write(0);Wire.endTransmission(false);Wire.requestFrom(0x68,3);while(Wire.available())Serial.println(Wire.read());}\nvoid loop(){}`
 await command('generate_firmware',{source})
 await page.goto(`/project/${project.id}`)
 await page.getByRole('button',{name:'Compile',exact:true}).click()
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled({timeout:100000})
 await page.getByRole('button',{name:'Run',exact:true}).click()
 await page.getByRole('button',{name:'Serial monitor',exact:true}).click()
 await expect(page.getByLabel('Serial output',{exact:true})).toContainText(type==='mpu6050'?'104':'52',{timeout:15000})
 await page.getByRole('button',{name:'Stop',exact:true}).click()
 await page.getByRole('button',{name:'Run',exact:true}).click()
 await expect(page.getByRole('button',{name:'Stop',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Stop',exact:true}).click()
})

test('unwired I2C target does not acknowledge a phantom device',async({page,request})=>{
 test.setTimeout(150000)
 const project=await(await request.post('/api/hardware/projects',{data:{name:'Unwired I2C',board:'arduino-uno'}})).json()
 await request.post(`/api/hardware/project/${project.id}/command`,{data:{name:'add_component',args:{type:'mpu6050',id:'sensor'}}})
 await request.post(`/api/hardware/project/${project.id}/command`,{data:{name:'generate_firmware',args:{source:'#include <Wire.h>\nvoid setup(){Serial.begin(9600);Wire.begin();Wire.beginTransmission(0x68);Serial.println(Wire.endTransmission());}\nvoid loop(){}'}}})
 await page.goto(`/project/${project.id}`)
 await page.getByRole('button',{name:'Compile',exact:true}).click()
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled({timeout:100000})
 await page.getByRole('button',{name:'Run',exact:true}).click()
 await page.getByRole('button',{name:'Serial monitor',exact:true}).click()
 await expect(page.getByLabel('Serial output',{exact:true})).toContainText('2',{timeout:15000})
 await page.getByRole('button',{name:'Stop',exact:true}).click()
})
