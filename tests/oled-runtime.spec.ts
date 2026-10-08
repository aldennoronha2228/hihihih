import {expect,test} from '@playwright/test'
test('Uno I2C OLED responds to actual Wire firmware and renders pixels',async({page,request})=>{
 test.setTimeout(180000)
 const project=await(await request.post('/api/hardware/projects',{data:{name:'OLED I2C',board:'arduino-uno'}})).json()
 const command=async(name:string,args:Record<string,unknown>)=>{const r=await request.post(`/api/hardware/project/${project.id}/command`,{data:{name,args}});expect(r.ok(),await r.text()).toBe(true)}
 await command('add_component',{type:'ssd1306-i2c-4pin',id:'oled',x:450,y:160})
 for(const [pin,target] of [['5V','VCC'],['GND','GND'],['A4','SDA'],['A5','SCL']])await command('connect_wire',{from:{component:'board',pin},to:{component:'oled',pin:target}})
 await command('generate_firmware',{source:'#include <Wire.h>\nvoid setup(){Serial.begin(9600);Wire.begin();Wire.beginTransmission(0x3c);Wire.write(0x00);Wire.write(0xAF);Wire.write(0x20);Wire.write(0x00);Wire.write(0x21);Wire.write(0);Wire.write(127);Wire.write(0x22);Wire.write(0);Wire.write(7);Serial.println(Wire.endTransmission());for(int i=0;i<1024;i+=16){Wire.beginTransmission(0x3c);Wire.write(0x40);for(int j=0;j<16;j++)Wire.write(0xFF);Wire.endTransmission();}}\nvoid loop(){}'})
 await page.goto(`/project/${project.id}`)
 await page.getByRole('button',{name:'Compile',exact:true}).click()
 await expect(page.getByRole('button',{name:'Run',exact:true})).toBeEnabled({timeout:100000})
 await page.getByRole('button',{name:'Run',exact:true}).click()
 await page.getByRole('button',{name:'Serial monitor',exact:true}).click()
 await expect(page.getByLabel('Serial output',{exact:true})).toContainText('0',{timeout:15000})
 await expect.poll(()=>page.locator('velxio-ssd1306-i2c-4pin').evaluate(e=>{const image=(e as HTMLElement &{imageData?:ImageData}).imageData;return !!image&&Array.from(image.data).some((v,i)=>i%4!==3&&v>0)}),{timeout:15000}).toBe(true)
 await page.getByRole('button',{name:'Stop',exact:true}).click()
})
